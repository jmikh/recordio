import { drawScreen } from '../../../core/painters/screenPainter';
import { paintMouseClicks } from '../../../core/painters/mouseClickPainter';
import { playClickSounds, playDragSounds, resetClickSounds } from '../../../core/audio/clickSoundPlayer';
import { drawDragEffects } from '../../../core/painters/mouseDragPainter';
import { drawCamera } from '../../../core/painters/cameraPainter';
import { drawKeyboardOverlay } from '../../../core/painters/keyboardPainter';
import { drawCaptions } from '../../../core/painters/captionPainter';
import { paintZoomDebug } from '../../../core/painters/zoomDebugPainter';


import { getViewportStateAtTime } from '../../../core/zoom';
import { getSpotlightStateAtTime } from '../../../core/spotlight/spotlightAnimator';
import { drawSpotlight } from '../../../core/painters/spotlightPainter';
import { getCameraStateAtTime, getCameraAnchor, scaleCameraSettings, getResolvedCameraStateAtTime } from '../../../core/zoom/cameraAnimator';
import type { TimeMapper } from '../../../core/mappers/timeMapper';
import { type FocusArea } from '../../../types';
import type { Project, Rect, CameraSettings } from '../../../types';
import type { UserEvents } from '@shared/types';

/** A video source that can be drawn with ctx.drawImage — either a DOM video element or a decoded WebCodecs frame */
export type VideoSource = HTMLVideoElement | VideoFrame;

export interface RenderResources {
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
    bgRef: HTMLImageElement | null;
    videoRefs: { [sourceId: string]: VideoSource };
    deviceFrameImg: HTMLImageElement | null;
}

export class PlaybackRenderer {
    static render(
        resources: RenderResources,
        state: {
            project: Project,
            userEvents: UserEvents,
            currentTimeMs: number,
            timeMapper: TimeMapper,
            overrideCameraSettings?: CameraSettings,
            focusAreas?: FocusArea[],
            showDebugOverlays?: boolean
        }
    ) {
        const { ctx, videoRefs } = resources;
        const { project, currentTimeMs, userEvents } = state;
        const outputSize = project.settings.outputSize;

        const { timeline } = project;

        // 3. Resolve sources directly from project
        const screenSource = project.screenSource;
        const cameraSource = project.cameraSource;

        // -----------------------------------------------------------
        // VIEWPORT CALCULATION
        // -----------------------------------------------------------
        let effectiveViewport: Rect;

        const zoomSegments = (project.settings.zoom.enabled ?? true)
            ? (timeline.zoomSegments || [])
            : [];
        const { timeMapper } = state;

        effectiveViewport = getViewportStateAtTime(
            zoomSegments,
            currentTimeMs,
            outputSize,
            project.settings.zoom
        );
        // -----------------------------------------------------------

        // Render Screen Layer
        let viewMapper: import('../../../core/mappers/viewMapper').ViewMapper | undefined;

        const screenVideo = videoRefs[screenSource.id];
        if (screenVideo) {
            const result = drawScreen(
                ctx,
                screenVideo,
                project,
                effectiveViewport,
                resources.deviceFrameImg,
                currentTimeMs,
                state.timeMapper,
                userEvents?.urlChanges
            );
            viewMapper = result.viewMapper;

            // Mouse click/drag effects (visual and sound are independent)
            const mouse = project.settings.mouse;
            if (mouse) {
                if (mouse.mouseClickEnabled) {
                    paintMouseClicks(ctx, userEvents.mouseClicks, currentTimeMs, effectiveViewport, viewMapper, mouse, timeMapper, project.settings.outputSize);
                }
                if (mouse.mouseDragEnabled) {
                    drawDragEffects(ctx, userEvents, currentTimeMs, effectiveViewport, viewMapper, mouse, timeMapper, project.settings.outputSize);
                }
                if (mouse.soundEnabled) {
                    playClickSounds(userEvents.mouseClicks, currentTimeMs, mouse.soundVolume ?? 0.5, timeMapper);
                    playDragSounds(userEvents.drags, currentTimeMs, mouse.soundVolume ?? 0.5, timeMapper);
                }
            }

            // DEBUG: Render zoom focus areas (controlled via DebugBar)
            if (state.showDebugOverlays && state.focusAreas) {
                paintZoomDebug(ctx, state.focusAreas, currentTimeMs, effectiveViewport, viewMapper);
            }
        }


        // Render Spotlight Overlay (after screen + effects, before keyboard/camera)
        // Spotlight samples the canvas as-is, so mouse clicks/drags are captured
        if (viewMapper && (project.settings.spotlight.enabled ?? true)) {
            const spotlightState = getSpotlightStateAtTime(
                timeline.spotlightSegments || [],
                project.settings.spotlight,
                currentTimeMs,
                effectiveViewport,
                viewMapper
            );

            drawSpotlight(ctx, spotlightState, outputSize, resources.canvas);
        }

        // Render Keyboard Overlay (after spotlight, so it appears on top of dimming)
        if (project.settings.keyboard?.showHotkeys ?? true) {
            drawKeyboardOverlay(
                ctx,
                userEvents.keyboardEvents,
                currentTimeMs,
                outputSize,
                timeMapper,
                project.settings.keyboard
            );
        }


        // Render Camera Layer (after spotlight, so camera always appears on top)
        if (cameraSource) {
            const video = videoRefs[cameraSource.id];
            if (video) {
                const cameraSettings = project.settings.camera;

                if (!cameraSettings) {
                    console.error(`[PlaybackRenderer] Missing camera settings for source ${cameraSource.id}`);
                    throw new Error("Mandatory camera settings are missing.");
                }

                if (state.overrideCameraSettings) {
                    // Override mode (drag preview): use provided settings directly, no resolver
                    drawCamera(ctx, video, cameraSource.size, state.overrideCameraSettings, outputSize);
                } else {
                    // Use the unified resolver: layout blocks → transitions → auto-shrink
                    const cameraMoveEnabled = project.settings.cameraMove?.enabled ?? true;
                    const resolved = getResolvedCameraStateAtTime(
                        cameraSettings,
                        cameraMoveEnabled ? (timeline.cameraMoveSegments || []) : [],
                        zoomSegments,
                        currentTimeMs,
                        outputSize,
                        project.settings.zoom
                    );

                    if (resolved.opacity > 0) {
                        const effectiveSettings: CameraSettings = {
                            ...cameraSettings,
                            xPx: resolved.xPx,
                            yPx: resolved.yPx,
                            widthPx: resolved.widthPx,
                            heightPx: resolved.heightPx,
                            shape: resolved.shape,
                            borderRadiusPx: resolved.borderRadiusPx,
                        };

                        // Apply opacity for fade transitions (hidden blocks)
                        if (resolved.opacity < 1) {
                            ctx.save();
                            ctx.globalAlpha = resolved.opacity;
                            drawCamera(ctx, video, cameraSource.size, effectiveSettings, outputSize);
                            ctx.restore();
                        } else {
                            drawCamera(ctx, video, cameraSource.size, effectiveSettings, outputSize);
                        }
                    }
                }
            }
        }

        // Render Captions (on top of everything including spotlight)
        if (project.settings.captions.enabled ?? true) {
            drawCaptions(
                ctx,
                timeline.captionSegments,
                project.settings.captions,
                currentTimeMs,
                outputSize
            );
        }
    }
}
