/**
 * Overlay Painter
 *
 * Draws overlay items (blur, text, arrow, border) on the canvas.
 * Used during playback and export (not during editing — the selected item
 * is rendered via HTML/SVG overlay instead).
 *
 * All coordinates are in OUTPUT pixels.
 */

import type { Size, Rect } from '../../types';
import type { OverlaySegment, OverlayItem, BlurOverlayItem, TextOverlayItem, ArrowOverlayItem, BorderOverlayItem } from '../../types/overlay';

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
    const effectScale = outputSize.height / REF_OUTPUT_HEIGHT;

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

        drawOverlayItem(ctx, item, outputSize, effectScale, viewport);
    }

    ctx.restore();
}

function drawOverlayItem(ctx: CanvasRenderingContext2D, item: OverlayItem, outputSize: Size, effectScale: number, viewport: Rect): void {
    switch (item.type) {
        case 'blur': return drawBlur(ctx, item, outputSize, viewport);
        case 'text': return drawText(ctx, item, outputSize);
        case 'arrow': return drawArrow(ctx, item, effectScale);
        case 'border': return drawBorder(ctx, item, effectScale);
    }
}

// ============================================================================
// BLUR
// ============================================================================

function drawBlur(ctx: CanvasRenderingContext2D, item: BlurOverlayItem, outputSize: Size, viewport: Rect): void {
    const { rectPx, blurRadiusPx, borderRadiusPx } = item;

    // Work entirely in canvas pixel space to avoid CTM/filter ambiguity.
    // The parent transform is scale(sx,sy) + translate(-vp.x,-vp.y).
    // We reset the transform and manually project all coordinates.
    const scaleX = outputSize.width / viewport.width;
    const scaleY = outputSize.height / viewport.height;

    // Project the overlay rect from output space to canvas pixel space
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
    ctx.beginPath();
    if (ctx.roundRect) {
        const scaledRadius = borderRadiusPx.map(r => r * scaleX) as [number, number, number, number];
        ctx.roundRect(canvasX, canvasY, canvasW, canvasH, scaledRadius);
    } else {
        ctx.rect(canvasX, canvasY, canvasW, canvasH);
    }
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

// ============================================================================
// TEXT
// ============================================================================

function drawText(ctx: CanvasRenderingContext2D, item: TextOverlayItem, outputSize: Size): void {
    const { topLeft, widthPx, text, fontSizePx, fontFamily, fontWeight, color } = item;

    ctx.save();

    // Painter-derived constants (not stored per-item)
    const scale = outputSize.height / TEXT_REF_HEIGHT;
    const pad = Math.round(TEXT_REF_PADDING * scale);
    const bgRadius = Math.round(TEXT_REF_RADIUS * scale);

    // Font
    const fontString = `${fontWeight} ${fontSizePx}px ${fontFamily}, sans-serif`;
    ctx.font = fontString;
    ctx.textBaseline = 'top';

    // Line wrapping
    const lineHeightPx = fontSizePx * 1.2;
    const lines = wrapLines(ctx, text || '', widthPx);

    // Background
    if (item.backgroundColor) {
        const bgH = lines.length * lineHeightPx + pad * 2;
        ctx.fillStyle = item.backgroundColor;
        ctx.beginPath();
        if (ctx.roundRect && bgRadius > 0) {
            ctx.roundRect(topLeft.x - pad, topLeft.y - pad, widthPx + pad * 2, bgH, bgRadius);
        } else {
            ctx.rect(topLeft.x - pad, topLeft.y - pad, widthPx + pad * 2, bgH);
        }
        ctx.fill();
    }

    // Fill text
    ctx.fillStyle = color;
    lines.forEach((line, i) => {
        ctx.fillText(line, topLeft.x, topLeft.y + i * lineHeightPx);
    });

    ctx.restore();
}

/** Word-wrap text into lines that fit within maxWidth, with character-level breaking for long words. */
function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
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
            let remaining = currentLine;
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
// ARROW
// ============================================================================

function drawArrow(ctx: CanvasRenderingContext2D, item: ArrowOverlayItem, effectScale: number): void {
    const { tail, head, strokeWidthPx, color } = item;

    ctx.save();

    // Shadow / Glow (derived from effect enum, matching camera painter pattern)
    if (item.effect === 'shadow') {
        ctx.shadowColor = SHADOW_COLOR;
        ctx.shadowBlur = REF_SHADOW_BLUR * effectScale;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = REF_SHADOW_OFFSET_Y * effectScale;
    } else if (item.effect === 'glow') {
        ctx.shadowColor = color;
        ctx.shadowBlur = REF_GLOW_BLUR * effectScale;
    }

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

    // Draw shaft
    ctx.beginPath();
    ctx.moveTo(tail.x, tail.y);
    ctx.lineTo(head.x - Math.cos(angle) * headSize * 0.7, head.y - Math.sin(angle) * headSize * 0.7);
    ctx.stroke();

    // Draw arrowhead
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

    ctx.restore();
}

// ============================================================================
// BORDER
// ============================================================================

function drawBorder(ctx: CanvasRenderingContext2D, item: BorderOverlayItem, effectScale: number): void {
    const { rectPx, borderWidthPx, color, borderRadiusPx } = item;

    ctx.save();

    // Shadow / Glow (derived from effect enum, matching camera painter pattern)
    if (item.effect === 'shadow') {
        ctx.shadowColor = SHADOW_COLOR;
        ctx.shadowBlur = REF_SHADOW_BLUR * effectScale;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = REF_SHADOW_OFFSET_Y * effectScale;
    } else if (item.effect === 'glow') {
        ctx.shadowColor = color;
        ctx.shadowBlur = REF_GLOW_BLUR * effectScale;
    }

    // Fill
    if (item.fillColor) {
        ctx.fillStyle = item.fillColor;
        ctx.beginPath();
        if (ctx.roundRect) {
            ctx.roundRect(rectPx.x, rectPx.y, rectPx.width, rectPx.height, borderRadiusPx);
        } else {
            ctx.rect(rectPx.x, rectPx.y, rectPx.width, rectPx.height);
        }
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
    ctx.beginPath();
    if (ctx.roundRect) {
        ctx.roundRect(insetX, insetY, insetW, insetH, borderRadiusPx);
    } else {
        ctx.rect(insetX, insetY, insetW, insetH);
    }
    ctx.stroke();

    ctx.restore();
}
