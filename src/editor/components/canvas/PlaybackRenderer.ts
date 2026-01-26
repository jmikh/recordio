import { drawScreen } from '../../../core/painters/screenPainter';
import { getTimeMapper } from '../../hooks/useTimeMapper';
import { paintMouseClicks } from '../../../core/painters/mouseClickPainter';
import { drawDragEffects } from '../../../core/painters/mouseDragPainter';
import { drawWebcam } from '../../../core/painters/webcamPainter';
import { drawKeyboardOverlay } from '../../../core/painters/keyboardPainter';
import { drawCaptions } from '../../../core/painters/captionPainter';


import { getViewportStateAtTime } from '../../../core/viewportMotion';
import { getSpotlightStateAtTime } from '../../../core/spotlightMotion';
import { drawSpotlight } from '../../../core/painters/spotlightPainter';
import { getCameraStateAtTime, getCameraAnchor, scaleCameraSettings } from '../../../core/cameraMotion';
import type { Project, Rect, CameraSettings } from '../../../core/types';
import type { ProjectState } from '../../stores/useProjectStore';

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
            sources: ProjectState['sources'],
            userEvents: ProjectState['userEvents'],
            currentTimeMs: number,
            overrideCameraSettings?: CameraSettings
        }
    ) {
        const { ctx, videoRefs } = resources;
        const { project, sources, userEvents, currentTimeMs } = state;
        const outputSize = project.settings.outputSize;

        const { timeline } = project;

        // 2. Calculate Times
        const sourceTimeMs = currentTimeMs;

        // 3. Resolve Items
        const screenSource = sources[timeline.screenSourceId];
        const cameraSource = timeline.cameraSourceId ? sources[timeline.cameraSourceId] : undefined;

        // -----------------------------------------------------------
        // VIEWPORT CALCULATION
        // -----------------------------------------------------------
        let effectiveViewport: Rect;


        const outputTimeMs = currentTimeMs;
        const viewportMotions = timeline.viewportMotions || [];

        effectiveViewport = getViewportStateAtTime(
            viewportMotions,
            outputTimeMs,
            outputSize
        );
        // -----------------------------------------------------------

        // Render Screen Layer
        let viewMapper: import('../../../core/viewMapper').ViewMapper | undefined;

        if (screenSource) {
            const video = videoRefs[screenSource.id];
            if (!video) {
                throw new Error(`[PlaybackRenderer] Video element not found for source ${screenSource.id}`);
            }

            const result = drawScreen(
                ctx,
                video,
                project,
                sources,
                effectiveViewport,
                resources.deviceFrameImg
            );
            viewMapper = result.viewMapper;

            // Conditionally render effects based on settings
            if (project.settings.effects?.showMouseClicks) {
                paintMouseClicks(ctx, userEvents.mouseClicks, sourceTimeMs, effectiveViewport, viewMapper);
            }
            if (project.settings.effects?.showMouseDrags) {
                drawDragEffects(ctx, userEvents.drags, sourceTimeMs, effectiveViewport, viewMapper);
            }
        }



        // Render Webcam Layer
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
                        viewportMotions,
                        currentTimeMs,
                        outputSize,
                        cameraSettings.shrinkScale ?? 0.5
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

        // Render Keyboard Overlay
        if (project.settings.effects?.showKeyboardClicks) {
            drawKeyboardOverlay(
                ctx,
                userEvents.keyboardEvents,
                sourceTimeMs,
                outputSize
            );
        }

        // Render Spotlight Overlay (after all content, before captions)
        // Spotlight is defined in source coordinates and mapped to output via viewMapper
        if (viewMapper) {
            const spotlightState = getSpotlightStateAtTime(
                timeline.spotlights || [],
                project.settings.spotlight,
                outputTimeMs,
                effectiveViewport,
                viewMapper
            );

            // Pass resources for scaled content rendering
            const screenVideo = screenSource ? videoRefs[screenSource.id] : undefined;
            drawSpotlight(ctx, spotlightState, outputSize, screenVideo ? {
                video: screenVideo,
                project,
                sources,
                effectiveViewport,
                deviceFrameImg: resources.deviceFrameImg
            } : undefined);
        }

        // Render Captions (on top of everything including spotlight)
        if (project.settings.captions.visible) {
            drawCaptions(
                ctx,
                timeline.captions,
                project.settings.captions,
                getTimeMapper(timeline.outputWindows),
                currentTimeMs,
                outputSize
            );
        }
    }
}
