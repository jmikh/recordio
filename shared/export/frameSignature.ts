/**
 * @fileoverview Frame signature for variable-frame-rate export.
 *
 * A signature is a compact serialization of everything that determines an
 * output frame's pixels. Two output times with equal signatures render
 * identical frames, so the export can skip drawing/encoding the later one and
 * let the previous frame last longer.
 *
 * Every component comes from the same helpers the painters draw with, so the
 * timing rules (effect windows, fades, source→output mapping) live in one place.
 * Layer gating mirrors `PlaybackRenderer.render` — when in doubt a component is
 * included: an extra component only costs an extra render, a missing one shows
 * a stale frame.
 *
 * Static-for-the-whole-export inputs (background, device frame, settings,
 * output size) are not part of the signature.
 */

import type { Project, UserEvents } from '../types';
import type { TimeMapper } from '../mappers/timeMapper';
import { getViewportStateAtTime } from '../animators/zoomAnimator';
import { getSpotlightStateAtTime } from '../animators/spotlightAnimator';
import { getResolvedCameraStateAtTime } from '../animators/cameraAnimator';
import { getActiveClicks } from '../painters/mouseClickPainter';
import { getActiveDrags } from '../painters/mouseDragPainter';
import { getKeyboardOverlayState } from '../painters/keyboardPainter';
import { getActiveCaptions } from '../painters/captionPainter';
import { getActiveOverlaySegments } from '../painters/overlayPainter';
import { createScreenViewMapper, getScreenInputSize, getToolbarAddressText } from '../painters/screenPainter';

export interface FrameSignatureInput {
    project: Project;
    projectName?: string;
    userEvents: UserEvents;
    timeMapper: TimeMapper;
    currentTimeMs: number;
    /** Decoded source frames for this output time, keyed by source storagePath */
    frameRefs: Record<string, VideoFrame>;
}

export function computeFrameSignature(input: FrameSignatureInput): string {
    const { project, projectName, userEvents, timeMapper, currentTimeMs, frameRefs } = input;
    const { settings, timeline } = project;
    const outputSize = settings.outputSize;
    const parts: Record<string, unknown> = {};

    const zoomSegments = (settings.zoom.enabled ?? true) ? (timeline.zoomSegments || []) : [];
    const viewport = getViewportStateAtTime(zoomSegments, currentTimeMs, outputSize, settings.zoom);
    parts.viewport = viewport;

    const screenFrame = frameRefs[project.screenSource.storagePath];
    if (screenFrame) {
        parts.screen = screenFrame.timestamp;

        if (settings.screen.toolbar.enabled) {
            parts.url = getToolbarAddressText(project, currentTimeMs, timeMapper, userEvents?.urlChanges, projectName);
        }

        const mouse = settings.mouse;
        if (mouse?.mouseClickEnabled) {
            parts.clicks = getActiveClicks(userEvents.mouseClicks, currentTimeMs, timeMapper)
                .map(c => [c.index, c.progress]);
        }
        if (mouse?.mouseDragEnabled) {
            parts.drags = getActiveDrags(userEvents, currentTimeMs, timeMapper)
                .map(d => [d.index, d.point.x, d.point.y]);
        }

        if (settings.spotlight.enabled ?? true) {
            const viewMapper = createScreenViewMapper(project, getScreenInputSize(screenFrame, project));
            parts.spotlight = getSpotlightStateAtTime(
                timeline.spotlightSegments || [],
                settings.spotlight,
                currentTimeMs,
                viewport,
                viewMapper
            );
        }
    }

    if (settings.keyboard?.showHotkeys ?? true) {
        const keyboard = getKeyboardOverlayState(userEvents.keyboardEvents, currentTimeMs, timeMapper);
        parts.keyboard = keyboard ? [keyboard.index, keyboard.opacity] : null;
    }

    if (settings.overlay?.enabled ?? true) {
        parts.overlays = getActiveOverlaySegments(timeline.overlaySegments || [], currentTimeMs).map(s => s.id);
    }

    const cameraSource = project.cameraSource;
    const cameraFrame = cameraSource ? frameRefs[cameraSource.storagePath] : undefined;
    if (cameraSource && cameraFrame && settings.camera) {
        const cameraMoveEnabled = settings.cameraMove?.enabled ?? true;
        const resolved = getResolvedCameraStateAtTime(
            settings.camera,
            cameraMoveEnabled ? (timeline.cameraMoveSegments || []) : [],
            zoomSegments,
            currentTimeMs,
            outputSize,
            settings.zoom
        );
        parts.camera = [resolved.xPx, resolved.yPx, resolved.widthPx, resolved.heightPx, resolved.shape, resolved.borderRadiusPx, resolved.opacity];
        // The camera video only affects the frame while it's drawn
        if (resolved.opacity > 0) {
            parts.cameraFrame = cameraFrame.timestamp;
        }
    }

    if (settings.captions.enabled ?? true) {
        parts.captions = getActiveCaptions(timeline.captionSegments, settings.captions, currentTimeMs)
            .map(c => [c.segment.id, c.highlightUpToIndex]);
    }

    return JSON.stringify(parts);
}
