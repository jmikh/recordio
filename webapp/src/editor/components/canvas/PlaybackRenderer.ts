import { drawScreen } from '../../../core/painters/screenPainter';
import { paintMouseClicks } from '../../../core/painters/mouseClickPainter';
import { drawDragEffects } from '../../../core/painters/mouseDragPainter';
import { drawCamera } from '../../../core/painters/cameraPainter';
import { drawKeyboardOverlay } from '../../../core/painters/keyboardPainter';
import { drawCaptions } from '../../../core/painters/captionPainter';
import { drawOverlays } from '../../../core/painters/overlayPainter';
import { paintZoomDebug } from '../../../core/painters/zoomDebugPainter';

import { getViewportStateAtTime } from '../../../core/zoom';
import { getSpotlightStateAtTime } from '../../../core/spotlight/spotlightAnimator';
import { drawSpotlight } from '../../../core/painters/spotlightPainter';
import { getResolvedCameraStateAtTime } from '../../../core/zoom/cameraAnimator';
import type { TimeMapper } from '../../../core/mappers/timeMapper';
import type { RenderContext } from '../../../core/renderContext';
import { type FocusArea } from '../../../types';
import type { Project, Rect, Size, CameraSettings } from '../../../types';
import type { UserEvents } from '@shared/types';

export interface RenderResources {
    ctx: CanvasRenderingContext2D;
    renderCtx: RenderContext;
    bgRef: CanvasImageSource | null;
    videoRefs: { [sourceId: string]: CanvasImageSource };
    deviceFrameImg: CanvasImageSource | null;
    /** Canvas element (or equivalent) for spotlight snapshot */
    sourceCanvas?: CanvasImageSource & Size;
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
        const { ctx, renderCtx, videoRefs } = resources;
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

            // Mouse click/drag effects (visual only — audio is handled by the caller)
            const mouse = project.settings.mouse;
            if (mouse) {
                if (mouse.mouseClickEnabled) {
                    paintMouseClicks(ctx, userEvents.mouseClicks, currentTimeMs, effectiveViewport, viewMapper, mouse, timeMapper, project.settings.outputSize);
                }
                if (mouse.mouseDragEnabled) {
                    drawDragEffects(ctx, userEvents, currentTimeMs, effectiveViewport, viewMapper, mouse, timeMapper, project.settings.outputSize);
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

            drawSpotlight(ctx, spotlightState, outputSize, resources.sourceCanvas, renderCtx);
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


        // Render Overlay annotations (before camera, so camera always appears on top)
        if (project.settings.overlay?.enabled ?? true) {
            const overlaySegments = timeline.overlaySegments || [];
            if (overlaySegments.length > 0) {
                drawOverlays(ctx, overlaySegments, currentTimeMs, outputSize, effectiveViewport);
            }
        }

        // Render Camera Layer (after overlays, so camera always appears on top)
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
                    drawCamera(ctx, video, cameraSource.size, state.overrideCameraSettings, outputSize, renderCtx);
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
                            drawCamera(ctx, video, cameraSource.size, effectiveSettings, outputSize, renderCtx);
                            ctx.restore();
                        } else {
                            drawCamera(ctx, video, cameraSource.size, effectiveSettings, outputSize, renderCtx);
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
