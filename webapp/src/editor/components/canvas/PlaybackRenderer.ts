import { drawScreen } from '../../../core/painters/screenPainter';
import { paintMouseClicks } from '../../../core/painters/mouseClickPainter';
import { drawDragEffects } from '../../../core/painters/mouseDragPainter';
import { drawWebcam } from '../../../core/painters/webcamPainter';
import { drawKeyboardOverlay } from '../../../core/painters/keyboardPainter';
import { drawCaptions } from '../../../core/painters/captionPainter';
import { paintZoomDebug } from '../../../core/painters/zoomDebugPainter';


import { getViewportStateAtTime } from '../../../core/zoom';
import { getSpotlightStateAtTime } from '../../../core/spotlight/spotlightMotion';
import { drawSpotlight } from '../../../core/painters/spotlightPainter';
import { getCameraStateAtTime, getCameraAnchor, scaleCameraSettings } from '../../../core/zoom/cameraZoom';
import { TimeMapper } from '../../../core/mappers/timeMapper';
import { type FocusArea } from '../../../types';
import type { Project, Rect, CameraSettings } from '../../../types';

export interface RenderResources {
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
    bgRef: HTMLImageElement | null;
    videoRefs: { [sourceId: string]: HTMLVideoElement };
    deviceFrameImg: HTMLImageElement | null;
}

export class PlaybackRenderer {
    static render(
        resources: RenderResources,
        state: {
            project: Project,
            currentTimeMs: number,
            overrideCameraSettings?: CameraSettings,
            isCameraEditing?: boolean,
            focusAreas?: FocusArea[],
            showDebugOverlays?: boolean
        }
    ) {
        const { ctx, videoRefs } = resources;
        const { project, currentTimeMs } = state;
        const { userEvents } = project;
        const outputSize = project.settings.outputSize;

        const { timeline } = project;

        // 2. Calculate Times
        const sourceTimeMs = currentTimeMs;

        // 3. Resolve sources directly from project
        const screenSource = project.screenSource;
        const cameraSource = project.cameraSource;

        // -----------------------------------------------------------
        // VIEWPORT CALCULATION
        // -----------------------------------------------------------
        let effectiveViewport: Rect;

        const outputTimeMs = currentTimeMs;
        const zoomActions = timeline.zoomActions || [];
        const timeMapper = new TimeMapper(timeline.outputWindows);

        effectiveViewport = getViewportStateAtTime(
            zoomActions,
            outputTimeMs,
            outputSize,
            timeMapper,
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
                resources.deviceFrameImg
            );
            viewMapper = result.viewMapper;

            // Conditionally render effects based on settings
            if (project.settings.effects?.showMouseClicks) {
                paintMouseClicks(ctx, userEvents.mouseClicks, sourceTimeMs, effectiveViewport, viewMapper);
            }
            if (project.settings.effects?.showMouseDrags) {
                drawDragEffects(ctx, userEvents, sourceTimeMs, effectiveViewport, viewMapper);
            }

            // DEBUG: Render zoom focus areas (controlled via DebugBar)
            if (state.showDebugOverlays && state.focusAreas) {
                paintZoomDebug(ctx, state.focusAreas, outputTimeMs, effectiveViewport, viewMapper);
            }
        }


        // Render Spotlight Overlay (after screen + effects, before keyboard/camera)
        // Spotlight samples the canvas as-is, so mouse clicks/drags are captured
        if (viewMapper) {
            const spotlightState = getSpotlightStateAtTime(
                timeline.spotlightActions || [],
                project.settings.spotlight,
                outputTimeMs,
                effectiveViewport,
                viewMapper,
                timeMapper
            );

            drawSpotlight(ctx, spotlightState, outputSize, resources.canvas);
        }

        // Render Keyboard Overlay (after spotlight, so it appears on top of dimming)
        if (project.settings.effects?.showKeyboardClicks) {
            drawKeyboardOverlay(
                ctx,
                userEvents.keyboardEvents,
                sourceTimeMs,
                outputSize
            );
        }


        // Render Webcam Layer (after spotlight, so camera always appears on top)
        if (cameraSource) {
            const video = videoRefs[cameraSource.id];
            if (video) {
                // Use Override (Drag) or Store (Settings) or Default
                const cameraSettings = state.overrideCameraSettings || project.settings.camera;

                if (!cameraSettings) {
                    console.error(`[PlaybackRenderer] Missing camera settings for source ${cameraSource.id}`);
                    throw new Error("Mandatory camera settings are missing.");
                }

                // Calculate effective camera settings with auto-shrink
                let effectiveCameraSettings = cameraSettings;

                // Only apply auto-shrink if enabled and not using override (drag preview) and not in camera edit mode
                if (cameraSettings.autoShrink && !state.overrideCameraSettings && !state.isCameraEditing) {
                    const cameraState = getCameraStateAtTime(
                        zoomActions,
                        currentTimeMs,
                        outputSize,
                        cameraSettings.shrinkScale ?? 0.5,
                        timeMapper,
                        project.settings.zoom
                    );

                    if (cameraState.sizeScale < 1.0) {
                        const anchor = getCameraAnchor(cameraSettings, outputSize);
                        effectiveCameraSettings = scaleCameraSettings(
                            cameraSettings,
                            cameraState.sizeScale,
                            anchor
                        );
                    }
                }

                drawWebcam(ctx, video, cameraSource.size, effectiveCameraSettings);
            }
        }

        // Render Captions (on top of everything including spotlight)
        if (project.settings.captions.visible) {
            const timeMapper = new TimeMapper(timeline.outputWindows);
            drawCaptions(
                ctx,
                timeline.captionSegments,
                project.settings.captions,
                timeMapper,
                currentTimeMs,
                outputSize
            );
        }
    }
}
