/**
 * Overlay Painter
 *
 * Draws screenshot annotation items (blur, text, arrow, border) on the canvas
 * via drawOverlayItem() — one item, no time dimension. The CALLER owns the
 * canvas transform; the paint context only carries the sizes the painters need
 * for blur projection and effect/text scaling.
 *
 * (Video projects no longer have overlays; their blur track is painted by
 * blurPainter, whose drawBlurRect primitive the blur items here share.)
 */

import type { Size, Rect } from '../types';
import type { OverlayItem, BlurOverlayItem, TextOverlayItem, ArrowOverlayItem, BorderOverlayItem } from '../types/overlay';
import { roundRectPath } from './utils/roundRect';
import { drawBlurRect } from './blurPainter';

// Reference constants — scaled by the caller's effectScale (matching camera painter pattern)
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
 * Screenshots pass the crop rect as viewport and width-based scales so a tall
 * full-page capture doesn't inflate shadows and text padding.
 */
export interface OverlayPaintContext {
    /** Logical canvas size (screenshot: crop size) */
    outputSize: Size;
    /** Region of document space currently mapped onto the canvas (screenshot: crop rect) */
    viewport: Rect;
    /** Multiplier for shadow/glow parameters */
    effectScale: number;
    /** Multiplier for text background padding/radius */
    textScale: number;
}

/**
 * Draws a single overlay item. The caller must already have applied the
 * document→canvas transform (scale by outputSize/viewport, translate by
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
    drawBlurRect(ctx, item.rectPx, item.blurRadiusPx, item.borderRadiusPx, paint.outputSize, paint.viewport);
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

/** Canvas font for a text overlay item. */
export function getOverlayTextFont(item: Pick<TextOverlayItem, 'fontSizePx' | 'fontFamily' | 'fontWeight'>): string {
    return `${item.fontWeight} ${item.fontSizePx}px ${item.fontFamily}, sans-serif`;
}

function drawText(ctx: CanvasRenderingContext2D, item: TextOverlayItem, textScale: number): void {
    const { topLeft, widthPx, text, fontSizePx, fontFamily, fontWeight, color } = item;

    ctx.save();

    // Painter-derived constants (not stored per-item)
    const pad = Math.round(TEXT_REF_PADDING * textScale);
    const bgRadius = Math.round(TEXT_REF_RADIUS * textScale);

    // Font
    const fontString = getOverlayTextFont({ fontSizePx, fontFamily, fontWeight });
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
