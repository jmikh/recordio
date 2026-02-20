import { drawScreen } from '../../../core/painters/screenPainter';
import { paintMouseClicks } from '../../../core/painters/mouseClickPainter';
import { playClickSounds, playDragSounds, resetClickSounds } from '../../../core/audio/clickSoundPlayer';
import { drawDragEffects } from '../../../core/painters/mouseDragPainter';
import { drawWebcam } from '../../../core/painters/webcamPainter';
import { drawKeyboardOverlay } from '../../../core/painters/keyboardPainter';
import { drawCaptions } from '../../../core/painters/captionPainter';
import { paintZoomDebug } from '../../../core/painters/zoomDebugPainter';


import { getViewportStateAtTime } from '../../../core/zoom';
import { getSpotlightStateAtTime } from '../../../core/spotlight/spotlightAnimator';
import { drawSpotlight } from '../../../core/painters/spotlightPainter';
import { getCameraStateAtTime, getCameraAnchor, scaleCameraSettings } from '../../../core/zoom/cameraZoom';
import type { TimeMapper } from '../../../core/mappers/timeMapper';
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
            timeMapper: TimeMapper,
            overrideCameraSettings?: CameraSettings,
            focusAreas?: FocusArea[],
            showDebugOverlays?: boolean
        }
    ) {
        const { ctx, videoRefs } = resources;
        const { project, currentTimeMs } = state;
        const { userEvents } = project;
        const outputSize = project.settings.outputSize;

        const { timeline } = project;

        // 3. Resolve sources directly from project
        const screenSource = project.screenSource;
        const cameraSource = project.cameraSource;

        // -----------------------------------------------------------
        // VIEWPORT CALCULATION
        // -----------------------------------------------------------
        let effectiveViewport: Rect;

        const zoomSegments = timeline.zoomSegments || [];
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
                state.timeMapper
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
        if (viewMapper) {
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

                // Only apply auto-shrink if enabled and not using override (drag preview)
                if (cameraSettings.autoShrink && !state.overrideCameraSettings) {
                    const cameraState = getCameraStateAtTime(
                        zoomSegments,
                        currentTimeMs,
                        outputSize,
                        cameraSettings.shrinkScale ?? 0.5,
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

                drawWebcam(ctx, video, cameraSource.size, effectiveCameraSettings, outputSize);
            }
        }

        // Render Captions (on top of everything including spotlight)
        if (project.settings.captions.visible) {
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
