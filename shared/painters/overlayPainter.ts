/**
 * Overlay Painter
 *
 * Draws overlay items (blur, text, arrow, border) on the canvas.
 * Used during playback and export (not during editing — the selected item
 * is rendered via HTML/SVG overlay instead).
 *
 * Two entry points:
 *   - drawOverlays()    — video: picks the segments active at a time, applies the
 *                         zoom-viewport transform, paints them back-to-front.
 *   - drawOverlayItem() — one item, no time dimension. Used by drawOverlays and by
 *                         the screenshot renderer (plans/screenshots). The CALLER
 *                         owns the canvas transform; the paint context only carries
 *                         the sizes the painters need for blur projection and
 *                         effect/text scaling.
 *
 * All coordinates are in OUTPUT pixels.
 */

import type { Size, Rect } from '../types';
import type { OverlaySegment, OverlayItem, BlurOverlayItem, TextOverlayItem, ArrowOverlayItem, BorderOverlayItem } from '../types/overlay';
import { roundRectPath } from './utils/roundRect';

// Reference constants — scaled proportionally to output height (matching camera painter pattern)
const REF_OUTPUT_HEIGHT = 1080;
const REF_SHADOW_BLUR = 20;
const SHADOW_COLOR = 'rgba(0,0,0,0.5)';
const REF_SHADOW_OFFSET_Y = 10;
const REF_GLOW_BLUR = 25;
const HEAD_SCALE = 1.0;

// Text overlay painter constants (not stored per-item — derived from output size)
export const TEXT_REF_HEIGHT = 1080;
export const TEXT_REF_PADDING = 8;
export const TEXT_REF_RADIUS = 6;

/** Minimum pixelate cell size in canvas pixels (below this it's just a blur-less copy). */
const MIN_PIXELATE_CELL = 2;

/**
 * What the per-item painters need beyond the item itself.
 *
 * Video passes outputSize + the zoom viewport and derives both scales from
 * outputSize.height / 1080. Screenshots pass the crop rect as viewport and
 * width-based scales so a tall full-page capture doesn't inflate shadows
 * and text padding.
 */
export interface OverlayPaintContext {
    /** Logical canvas size (video: output size; screenshot: crop size) */
    outputSize: Size;
    /** Region of output space currently mapped onto the canvas (video: zoom viewport; screenshot: crop rect) */
    viewport: Rect;
    /** Multiplier for shadow/glow parameters */
    effectScale: number;
    /** Multiplier for text background padding/radius */
    textScale: number;
}

/**
 * Draws all overlay items for the given time.
 * @param ctx - Canvas 2D context
 * @param overlaySegments - All overlay segments in the project
 * @param currentTimeMs - Current output time in ms
 * @param outputSize - Output canvas size
 * @param viewport - Current zoom viewport in output coordinates
 * @param editingItemId - Item currently being edited (skip to avoid double-render)
 */
export function drawOverlays(
    ctx: CanvasRenderingContext2D,
    overlaySegments: OverlaySegment[],
    currentTimeMs: number,
    outputSize: Size,
    viewport: Rect,
    editingItemId?: string | null
): void {
    const scale = outputSize.height / REF_OUTPUT_HEIGHT;
    const paint: OverlayPaintContext = { outputSize, viewport, effectScale: scale, textScale: scale };

    // Apply viewport transform: overlay coordinates are in output space,
    // so we scale + translate to project them through the zoom viewport.
    // When not zoomed, viewport === outputSize → scale=1, translate=0 (no-op).
    const scaleX = outputSize.width / viewport.width;
    const scaleY = outputSize.height / viewport.height;

    ctx.save();
    ctx.scale(scaleX, scaleY);
    ctx.translate(-viewport.x, -viewport.y);

    // Find active segments at this time, sorted by duration descending
    // so shorter overlays paint on top
    const activeSegments = overlaySegments
        .filter(segment => {
            if (!segment.visible) return false;
            if (currentTimeMs < segment.outputStartTimeMs || currentTimeMs > segment.outputEndTimeMs) return false;
            return true;
        })
        .sort((a, b) => {
            const durA = a.outputEndTimeMs - a.outputStartTimeMs;
            const durB = b.outputEndTimeMs - b.outputStartTimeMs;
            return durB - durA; // longest first (painted first = behind)
        });

    for (const segment of activeSegments) {
        const item = segment.item;
        // Only skip text when being edited (rendered via HTML for inline editing).
        if (editingItemId && item.id === editingItemId && item.type === 'text') continue;

        drawOverlayItem(ctx, item, paint);
    }

    ctx.restore();
}

/**
 * Draws a single overlay item. The caller must already have applied the
 * output→canvas transform (scale by outputSize/viewport, translate by
 * -viewport). Blur/pixelate reset the transform internally and project
 * through `paint.viewport` themselves, because ctx.filter and drawImage
 * self-copies are ambiguous under a non-identity CTM.
 */
export function drawOverlayItem(ctx: CanvasRenderingContext2D, item: OverlayItem, paint: OverlayPaintContext): void {
    switch (item.type) {
        case 'blur': return item.mode === 'pixelate'
            ? drawPixelate(ctx, item, paint)
            : drawBlur(ctx, item, paint);
        case 'text': return drawText(ctx, item, paint.textScale);
        case 'arrow': return drawArrow(ctx, item, paint.effectScale);
        case 'border': return drawBorder(ctx, item, paint.effectScale);
    }
}

// ============================================================================
// BLUR / PIXELATE
// ============================================================================

/** Projects an output-space rect into raw canvas pixel space through the viewport. */
function projectRect(rectPx: Rect, paint: OverlayPaintContext) {
    const { outputSize, viewport } = paint;
    const scaleX = outputSize.width / viewport.width;
    const scaleY = outputSize.height / viewport.height;
    return {
        scaleX,
        scaleY,
        canvasX: (rectPx.x - viewport.x) * scaleX,
        canvasY: (rectPx.y - viewport.y) * scaleY,
        canvasW: rectPx.width * scaleX,
        canvasH: rectPx.height * scaleY,
    };
}

function drawBlur(ctx: CanvasRenderingContext2D, item: BlurOverlayItem, paint: OverlayPaintContext): void {
    const { blurRadiusPx, borderRadiusPx } = item;

    // Work entirely in canvas pixel space to avoid CTM/filter ambiguity.
    // The parent transform is scale(sx,sy) + translate(-vp.x,-vp.y).
    // We reset the transform and manually project all coordinates.
    const { scaleX, canvasX, canvasY, canvasW, canvasH } = projectRect(item.rectPx, paint);

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

/** Scratch canvas for pixelate downsampling — reused across calls (never displayed). */
let scratchCanvas: OffscreenCanvas | HTMLCanvasElement | null = null;

function getScratchCanvas(width: number, height: number): OffscreenCanvas | HTMLCanvasElement {
    if (!scratchCanvas) {
        scratchCanvas = typeof OffscreenCanvas !== 'undefined'
            ? new OffscreenCanvas(width, height)
            : document.createElement('canvas');
    }
    if (scratchCanvas.width !== width) scratchCanvas.width = width;
    if (scratchCanvas.height !== height) scratchCanvas.height = height;
    return scratchCanvas;
}

/**
 * Pixelate: downsample the region to (size / cell) with smoothing, then draw it
 * back at full size with smoothing OFF so each source cell becomes a flat block.
 * Unlike ctx.filter blur this works on every canvas implementation (Safari < 18
 * has no ctx.filter), which is why screenshots default new items to it there.
 */
function drawPixelate(ctx: CanvasRenderingContext2D, item: BlurOverlayItem, paint: OverlayPaintContext): void {
    const { blurRadiusPx, borderRadiusPx } = item;
    const { scaleX, canvasX, canvasY, canvasW, canvasH } = projectRect(item.rectPx, paint);
    if (canvasW < 1 || canvasH < 1) return;

    const cell = Math.max(MIN_PIXELATE_CELL, blurRadiusPx * scaleX);
    const smallW = Math.max(1, Math.ceil(canvasW / cell));
    const smallH = Math.max(1, Math.ceil(canvasH / cell));

    const scratch = getScratchCanvas(smallW, smallH);
    const sctx = scratch.getContext('2d') as CanvasRenderingContext2D | null;
    if (!sctx) return;
    sctx.imageSmoothingEnabled = true;
    sctx.clearRect(0, 0, smallW, smallH);
    sctx.drawImage(ctx.canvas, canvasX, canvasY, canvasW, canvasH, 0, 0, smallW, smallH);

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const scaledRadius = borderRadiusPx.map(r => r * scaleX) as [number, number, number, number];
    roundRectPath(ctx, canvasX, canvasY, canvasW, canvasH, scaledRadius);
    ctx.clip();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(scratch, 0, 0, smallW, smallH, canvasX, canvasY, canvasW, canvasH);
    ctx.restore();
}

// ============================================================================
// TEXT
// ============================================================================

function drawText(ctx: CanvasRenderingContext2D, item: TextOverlayItem, textScale: number): void {
    const { topLeft, widthPx, text, fontSizePx, fontFamily, fontWeight, color } = item;

    ctx.save();

    // Painter-derived constants (not stored per-item)
    const pad = Math.round(TEXT_REF_PADDING * textScale);
    const bgRadius = Math.round(TEXT_REF_RADIUS * textScale);

    // Font
    const fontString = `${fontWeight} ${fontSizePx}px ${fontFamily}, sans-serif`;
    ctx.font = fontString;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';

    // Line wrapping
    const lineHeightPx = fontSizePx * 1.2;
    const lines = wrapLines(ctx, text || '', widthPx);

    // Background
    if (item.backgroundColor) {
        const bgH = lines.length * lineHeightPx + pad * 2;
        ctx.fillStyle = item.backgroundColor;
        roundRectPath(ctx, topLeft.x - pad, topLeft.y - pad, widthPx + pad * 2, bgH, bgRadius);
        ctx.fill();
    }

    // Fill text
    ctx.fillStyle = color;
    const centerX = topLeft.x + widthPx / 2;
    lines.forEach((line, i) => {
        ctx.fillText(line, centerX, topLeft.y + i * lineHeightPx + lineHeightPx / 2);
    });

    ctx.restore();
}

/**
 * Word-wrap text into lines that fit within maxWidth, with character-level
 * breaking for long words. `ctx.font` must already be set. Exported so the
 * screenshot editor can measure a text item's height for hit-testing.
 */
export function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
    const words = text.split(' ');
    const lines: string[] = [];
    let currentLine = '';

    for (const word of words) {
        const testLine = currentLine ? `${currentLine} ${word}` : word;
        const testWidth = ctx.measureText(testLine).width;

        if (testWidth > maxWidth && currentLine) {
            lines.push(currentLine);
            currentLine = word;
        } else {
            currentLine = testLine;
        }

        // If current word alone exceeds maxWidth, break it character by character
        if (ctx.measureText(currentLine).width > maxWidth) {
            const remaining = currentLine;
            currentLine = '';
            for (const char of remaining) {
                const test = currentLine + char;
                if (ctx.measureText(test).width > maxWidth && currentLine) {
                    lines.push(currentLine);
                    currentLine = char;
                } else {
                    currentLine = test;
                }
            }
        }
    }

    if (currentLine) lines.push(currentLine);
    if (lines.length === 0) lines.push('');

    return lines;
}

// ============================================================================
// ARROW / LINE
// ============================================================================

function applyEffect(ctx: CanvasRenderingContext2D, effect: ArrowOverlayItem['effect'], color: string, effectScale: number): void {
    // Shadow / Glow (derived from effect enum, matching camera painter pattern)
    if (effect === 'shadow') {
        ctx.shadowColor = SHADOW_COLOR;
        ctx.shadowBlur = REF_SHADOW_BLUR * effectScale;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = REF_SHADOW_OFFSET_Y * effectScale;
    } else if (effect === 'glow') {
        ctx.shadowColor = color;
        ctx.shadowBlur = REF_GLOW_BLUR * effectScale;
    }
}

function drawArrow(ctx: CanvasRenderingContext2D, item: ArrowOverlayItem, effectScale: number): void {
    const { tail, head, strokeWidthPx, color } = item;
    const hasHead = item.headStyle !== 'none';

    ctx.save();
    applyEffect(ctx, item.effect, color, effectScale);

    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = strokeWidthPx;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Calculate angle
    const dx = head.x - tail.x;
    const dy = head.y - tail.y;
    const angle = Math.atan2(dy, dx);

    // Arrowhead size (fixed scale, no longer stored per-item)
    const headSize = strokeWidthPx * 4 * HEAD_SCALE;

    // Draw shaft — stops short of the tip when there's a head so the stroke
    // cap doesn't poke out of the triangle; a plain line runs all the way.
    const shaftEndX = hasHead ? head.x - Math.cos(angle) * headSize * 0.7 : head.x;
    const shaftEndY = hasHead ? head.y - Math.sin(angle) * headSize * 0.7 : head.y;
    ctx.beginPath();
    ctx.moveTo(tail.x, tail.y);
    ctx.lineTo(shaftEndX, shaftEndY);
    ctx.stroke();

    // Draw arrowhead
    if (hasHead) {
        ctx.beginPath();
        ctx.moveTo(head.x, head.y);
        ctx.lineTo(
            head.x - headSize * Math.cos(angle - Math.PI / 6),
            head.y - headSize * Math.sin(angle - Math.PI / 6)
        );
        ctx.lineTo(
            head.x - headSize * Math.cos(angle + Math.PI / 6),
            head.y - headSize * Math.sin(angle + Math.PI / 6)
        );
        ctx.closePath();
        ctx.fill();
    }

    ctx.restore();
}

// ============================================================================
// BORDER (rect / ellipse)
// ============================================================================

function ellipsePath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
    ctx.beginPath();
    ctx.ellipse(x + w / 2, y + h / 2, Math.max(0, w / 2), Math.max(0, h / 2), 0, 0, Math.PI * 2);
}

function drawBorder(ctx: CanvasRenderingContext2D, item: BorderOverlayItem, effectScale: number): void {
    const { rectPx, borderWidthPx, color, borderRadiusPx } = item;
    const isEllipse = item.shape === 'ellipse';

    ctx.save();
    applyEffect(ctx, item.effect, color, effectScale);

    // Fill
    if (item.fillColor) {
        ctx.fillStyle = item.fillColor;
        if (isEllipse) ellipsePath(ctx, rectPx.x, rectPx.y, rectPx.width, rectPx.height);
        else roundRectPath(ctx, rectPx.x, rectPx.y, rectPx.width, rectPx.height, borderRadiusPx);
        ctx.fill();
    }

    // Border stroke — drawn inward by insetting path by half the stroke width
    const hw = borderWidthPx / 2;
    const insetX = rectPx.x + hw;
    const insetY = rectPx.y + hw;
    const insetW = rectPx.width - borderWidthPx;
    const insetH = rectPx.height - borderWidthPx;

    ctx.strokeStyle = color;
    ctx.lineWidth = borderWidthPx;
    if (isEllipse) ellipsePath(ctx, insetX, insetY, insetW, insetH);
    else roundRectPath(ctx, insetX, insetY, insetW, insetH, borderRadiusPx);
    ctx.stroke();

    ctx.restore();
}
