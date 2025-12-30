import type { UserEvents, Project, TimeMs } from '../types';
import { ViewMapper } from '../viewMapper';
import { paintMouseClicks } from './mouseClickPainter';
import { drawDragEffects } from './mouseDragPainter';
import { TimeMapper } from '../timeMapper';
import { getViewportStateAtTime } from '../viewportMotion';

/**
 * Draws the screen recording frame.
 * Encapsulates logic for viewport calculation and event lookup.
 */
export function drawScreen(
    ctx: CanvasRenderingContext2D,
    video: HTMLVideoElement,
    project: Project,
    userEvents: UserEvents | null,
    currentTimeMs: TimeMs
) {
    const { timeline, sources } = project;
    const { recording, outputWindows } = timeline;

    // 1. Resolve Data
    const screenSource = sources[recording.screenSourceId];
    if (!screenSource) return;

    // Initialize TimeMapper
    const timeMapper = new TimeMapper(recording.timelineOffsetMs, outputWindows);

    // 2. Calculate Times
    // Source Time: time relative to the video file
    const sourceTimeMs = currentTimeMs - recording.timelineOffsetMs;
    // Output Time: time relative to the gapless output video
    const outputTimeMs = timeMapper.mapTimelineToOutputTime(currentTimeMs);

    // 3. Resolve Viewport
    const viewportMotions = recording.viewportMotions || [];
    const effectiveViewport = getViewportStateAtTime(
        viewportMotions,
        outputTimeMs, // Use Output Time for Viewport motion (smoothness)
        project.settings.outputSize,
        timeMapper
    );

    // Use video dimensions if available, otherwise source metadata
    // Note: Video dimensions might be 0 if not loaded, fallback to metadata size
    const inputSize = video.videoWidth && video.videoHeight
        ? { width: video.videoWidth, height: video.videoHeight }
        : screenSource.size;

    if (!inputSize || inputSize.width === 0) return;

    // 4. Resolve View Mapping
    const outputSize = project.settings.outputSize;
    const padding = project.settings.padding;
    const viewMapper = new ViewMapper(inputSize, outputSize, padding);

    // 5. Draw Video
    const renderRects = viewMapper.resolveRenderRects(effectiveViewport);
    if (renderRects) {
        ctx.drawImage(
            video,
            renderRects.sourceRect.x, renderRects.sourceRect.y, renderRects.sourceRect.width, renderRects.sourceRect.height,
            renderRects.destRect.x, renderRects.destRect.y, renderRects.destRect.width, renderRects.destRect.height
        );
    }

    // 6. Draw Mouse Effects Overlay
    if (userEvents) {
        // These painters use Source Time because events are recorded in Source Time
        if (userEvents.mouseClicks) {
            paintMouseClicks(ctx, userEvents.mouseClicks, sourceTimeMs, effectiveViewport, viewMapper);
        }
        if (userEvents.drags) {
            drawDragEffects(ctx, userEvents.drags, sourceTimeMs, effectiveViewport, viewMapper);
        }
    }
}
