/**
 * Blur Painter
 *
 * Draws the blur track: the (single, non-overlapping) blur segment active at a
 * time blurs each of its regions in place on the canvas. Used during playback,
 * export and the editor canvas modes.
 *
 * drawBlurRect() is the per-rectangle primitive, also used by the screenshot
 * annotation painter (overlayPainter) for its blur items.
 *
 * All region coordinates are in OUTPUT pixels.
 */

import type { Size, Rect } from '../types';
import type { BlurRegion, BlurSegment } from '../types/blur';
import { roundRectPath } from './utils/roundRect';

/** Returns the blur segment shown at the given output time, if any (segments never overlap). */
export function getActiveBlurSegment(blurSegments: BlurSegment[], currentTimeMs: number): BlurSegment | undefined {
    return blurSegments.find(segment =>
        segment.visible &&
        currentTimeMs >= segment.outputStartTimeMs &&
        currentTimeMs <= segment.outputEndTimeMs
    );
}

/**
 * Draws the regions of the blur segment active at `currentTimeMs`.
 * @param viewport - Current zoom viewport in output coordinates
 */
export function drawBlurs(
    ctx: CanvasRenderingContext2D,
    blurSegments: BlurSegment[],
    currentTimeMs: number,
    outputSize: Size,
    viewport: Rect,
): void {
    const segment = getActiveBlurSegment(blurSegments, currentTimeMs);
    if (segment) drawBlurSegment(ctx, segment, outputSize, viewport);
}

/**
 * Draws every region of one segment regardless of time. The blur editor uses
 * this for the segment being edited, passing `regions` to substitute the
 * in-drag replica for the stored ones.
 */
export function drawBlurSegment(
    ctx: CanvasRenderingContext2D,
    segment: BlurSegment,
    outputSize: Size,
    viewport: Rect,
    regions: BlurRegion[] = segment.regions,
): void {
    for (const region of regions) {
        drawBlurRect(ctx, region.rectPx, segment.blurRadiusPx, region.borderRadiusPx, outputSize, viewport);
    }
}

/**
 * Blurs one output-space rectangle of what is already on the canvas.
 *
 * Works entirely in canvas pixel space: the transform is reset to identity and
 * the rect is projected through `viewport` manually, because ctx.filter and
 * drawImage self-copies are ambiguous under a non-identity CTM. The caller's
 * transform is therefore irrelevant (and restored afterwards).
 */
export function drawBlurRect(
    ctx: CanvasRenderingContext2D,
    rectPx: Rect,
    blurRadiusPx: number,
    borderRadiusPx: [number, number, number, number],
    outputSize: Size,
    viewport: Rect,
): void {
    const scaleX = outputSize.width / viewport.width;
    const scaleY = outputSize.height / viewport.height;
    const canvasX = (rectPx.x - viewport.x) * scaleX;
    const canvasY = (rectPx.y - viewport.y) * scaleY;
    const canvasW = rectPx.width * scaleX;
    const canvasH = rectPx.height * scaleY;

    // Scale blur radius by zoom so blur stays equally effective at all zoom levels.
    // When zoomed in 2×, content pixels double, so blur kernel must double too.
    const scaledBlur = blurRadiusPx * scaleX;

    ctx.save();

    // Reset transform — we'll work in raw canvas pixel coordinates
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    // Create clipping path in canvas pixel space
    const scaledRadius = borderRadiusPx.map(r => r * scaleX) as [number, number, number, number];
    roundRectPath(ctx, canvasX, canvasY, canvasW, canvasH, scaledRadius);
    ctx.clip();

    // Apply blur filter (now unambiguously in canvas pixel space)
    ctx.filter = `blur(${scaledBlur}px)`;

    // Expand source area by blur radius so the kernel has real pixel data at the edges.
    const expand = scaledBlur * 2;
    const srcX = Math.max(0, canvasX - expand);
    const srcY = Math.max(0, canvasY - expand);
    const srcW = canvasW + expand * 2;
    const srcH = canvasH + expand * 2;

    // 1:1 copy with blur — source and dest are the same canvas pixel coordinates
    ctx.drawImage(ctx.canvas, srcX, srcY, srcW, srcH, srcX, srcY, srcW, srcH);

    ctx.filter = 'none';
    ctx.restore();
}
