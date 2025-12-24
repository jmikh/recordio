
import type { Size } from '../../core/types';
import type { RenderState } from '../../core/project/Project';
import { ViewMapper } from '../../core/effects/viewMapper';
import { getViewportStateAtTime } from '../../core/effects/viewportMotion';
import { paintMouseClicks } from './mouseClickPainter';
import { drawDragEffects } from './mouseDragPainter';

/**
 * Draws the screen recording frame, applying viewport transformations and mouse effects.
 */
export function drawScreen(
    ctx: CanvasRenderingContext2D,
    video: HTMLVideoElement,
    renderState: RenderState,
    outputSize: Size,
    padding: number
) {
    const { screenSource, recording, sourceTimeMs } = renderState;
    if (!screenSource) return;

    // Use video dimensions if available, otherwise source metadata
    const inputSize = video.videoWidth && video.videoHeight
        ? { width: video.videoWidth, height: video.videoHeight }
        : screenSource.size;

    if (!inputSize) return;

    const paddingPercentage = padding;

    // 1. Calculate Viewport (Output Space)
    const viewMapper = new ViewMapper(inputSize, outputSize, paddingPercentage);
    const viewportMotions = recording.viewportMotions || [];

    // Calculate effective viewport using output time (gapless time)
    // We assume renderState has been augmented with outputTimeMs
    const outputTimeMs = (renderState as any).outputTimeMs || 0;

    // Calculate the effective viewport at the current playback time (Output Time)
    const effectiveViewport = getViewportStateAtTime(viewportMotions, outputTimeMs, outputSize);

    // 2. Resolve render rectangles (Source -> Dest)
    const renderRects = viewMapper.resolveRenderRects(effectiveViewport);

    if (renderRects) {
        ctx.drawImage(
            video,
            renderRects.sourceRect.x, renderRects.sourceRect.y, renderRects.sourceRect.width, renderRects.sourceRect.height,
            renderRects.destRect.x, renderRects.destRect.y, renderRects.destRect.width, renderRects.destRect.height
        );
    }

    // 3. Draw Mouse Effects Overlay
    if (recording.clickEvents) {
        paintMouseClicks(ctx, recording.clickEvents, sourceTimeMs, effectiveViewport, viewMapper);
    }
    if (recording.dragEvents) {
        drawDragEffects(ctx, recording.dragEvents, sourceTimeMs, effectiveViewport, viewMapper);
    }
}
