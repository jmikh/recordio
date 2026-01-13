import { drawScreen } from '../../../core/painters/screenPainter';
import { getTimeMapper } from '../../hooks/useTimeMapper';
import { paintMouseClicks } from '../../../core/painters/mouseClickPainter';
import { drawDragEffects } from '../../../core/painters/mouseDragPainter';
import { drawWebcam } from '../../../core/painters/webcamPainter';
import { drawKeyboardOverlay } from '../../../core/painters/keyboardPainter';
import { drawCaptions } from '../../../core/painters/captionPainter';


import { getViewportStateAtTime } from '../../../core/viewportMotion';
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
        const { recording } = timeline;

        // 2. Calculate Times
        const sourceTimeMs = currentTimeMs;

        // 3. Resolve Items
        const screenSource = sources[recording.screenSourceId];
        const cameraSource = recording.cameraSourceId ? sources[recording.cameraSourceId] : undefined;

        // -----------------------------------------------------------
        // VIEWPORT CALCULATION
        // -----------------------------------------------------------
        let effectiveViewport: Rect;


        const outputTimeMs = currentTimeMs;
        const viewportMotions = recording.viewportMotions || [];

        effectiveViewport = getViewportStateAtTime(
            viewportMotions,
            outputTimeMs,
            outputSize
        );
        // -----------------------------------------------------------

        // Render Screen Layer
        if (screenSource) {
            const video = videoRefs[screenSource.id];
            if (!video) {
                throw new Error(`[PlaybackRenderer] Video element not found for source ${screenSource.id}`);
            }

            const { viewMapper } = drawScreen(
                ctx,
                video,
                project,
                sources,
                effectiveViewport,
                resources.deviceFrameImg
            );

            paintMouseClicks(ctx, userEvents.mouseClicks, sourceTimeMs, effectiveViewport, viewMapper);
            drawDragEffects(ctx, userEvents.drags, sourceTimeMs, effectiveViewport, viewMapper);
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

                drawWebcam(ctx, video, cameraSource.size, cameraSettings);
            }
        }

        // Render Keyboard Overlay
        drawKeyboardOverlay(
            ctx,
            userEvents.keyboardEvents,
            sourceTimeMs,
            outputSize
        );

        // Render Captions
        if (project.settings.captions.visible) {
            drawCaptions(
                ctx,
                recording.captions,
                project.settings.captions,
                getTimeMapper(timeline.outputWindows),
                currentTimeMs,
                outputSize
            );
        }
    }
}
