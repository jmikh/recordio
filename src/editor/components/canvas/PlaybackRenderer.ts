import { drawScreen } from '../../../core/painters/screenPainter';
import { paintMouseClicks } from '../../../core/painters/mouseClickPainter';
import { drawDragEffects } from '../../../core/painters/mouseDragPainter';
import { drawWebcam } from '../../../core/painters/webcamPainter';
import { drawKeyboardOverlay } from '../../../core/painters/keyboardPainter';
import { TimeMapper } from '../../../core/timeMapper';
import { getViewportStateAtTime } from '../../../core/viewportMotion';
import type { Project } from '../../../core/types';
import type { ProjectState } from '../../stores/useProjectStore';

export interface RenderResources {
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
    bgRef: HTMLImageElement | null;
    videoRefs: { [sourceId: string]: HTMLVideoElement };
}

export class PlaybackRenderer {
    static render(
        resources: RenderResources,
        state: {
            project: Project,
            sources: ProjectState['sources'],
            userEvents: ProjectState['userEvents'],
            currentTimeMs: number
        }
    ) {
        const { ctx, videoRefs } = resources;
        const { project, sources, userEvents, currentTimeMs } = state;
        const outputSize = project.settings.outputSize;

        const { timeline } = project;
        const { recording, outputWindows } = timeline;

        // 1. Check if ACTIVE
        const activeWindow = outputWindows.find(w => currentTimeMs >= w.startMs && currentTimeMs <= w.endMs);
        if (!activeWindow) return;

        // 2. Calculate Times
        const sourceTimeMs = currentTimeMs - recording.timelineOffsetMs;

        // 3. Resolve Items
        const screenSource = sources[recording.screenSourceId];
        const cameraSource = recording.cameraSourceId ? sources[recording.cameraSourceId] : undefined;

        // -----------------------------------------------------------
        // VIEWPORT CALCULATION
        // -----------------------------------------------------------
        const timeMapper = new TimeMapper(recording.timelineOffsetMs, outputWindows);
        const outputTimeMs = timeMapper.mapTimelineToOutputTime(currentTimeMs);
        const viewportMotions = recording.viewportMotions || [];

        const effectiveViewport = getViewportStateAtTime(
            viewportMotions,
            outputTimeMs,
            outputSize,
            timeMapper
        );
        // -----------------------------------------------------------

        // Render Screen Layer
        if (screenSource) {
            const video = videoRefs[screenSource.id];
            const result = drawScreen(
                ctx,
                video,
                project,
                sources,
                effectiveViewport
            );

            if (result && userEvents) {
                const { viewMapper } = result;
                // Mouse Overlays (now managed here explicitly)
                if (userEvents.mouseClicks) {
                    paintMouseClicks(ctx, userEvents.mouseClicks, sourceTimeMs, effectiveViewport, viewMapper);
                }
                if (userEvents.drags) {
                    drawDragEffects(ctx, userEvents.drags, sourceTimeMs, effectiveViewport, viewMapper);
                }
            }

        }

        // Render Webcam Layer
        if (cameraSource) {
            const video = videoRefs[cameraSource.id];
            if (video) {
                drawWebcam(ctx, video, outputSize, cameraSource.size);
            }
        }

        // Render Keyboard Overlay
        if (userEvents && userEvents.keyboardEvents) {
            drawKeyboardOverlay(
                ctx,
                userEvents.keyboardEvents,
                sourceTimeMs,
                outputSize
            );
        }
    }
}
