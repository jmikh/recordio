/**
 * Overlay Painter
 *
 * Draws overlay items (blur, text, arrow, border) on the canvas.
 * Used during playback and export (not during editing — the selected item
 * is rendered via HTML/SVG overlay instead).
 *
 * All coordinates are in OUTPUT pixels.
 */

import type { Size } from '../../types';
import type { OverlayBlock, OverlayItem, BlurOverlayItem, TextOverlayItem, ArrowOverlayItem, BorderOverlayItem } from '../../types/overlay';

/**
 * Draws all overlay items for the given time.
 * @param ctx - Canvas 2D context
 * @param overlayBlocks - All overlay blocks in the project
 * @param currentTimeMs - Current output time in ms
 * @param outputSize - Output canvas size
 * @param editingItemId - Item currently being edited (skip to avoid double-render)
 */
export function drawOverlays(
    ctx: CanvasRenderingContext2D,
    overlayBlocks: OverlayBlock[],
    currentTimeMs: number,
    outputSize: Size,
    editingItemId?: string | null
): void {
    // Find active blocks at this time
    for (const block of overlayBlocks) {
        if (!block.visible) continue;
        if (currentTimeMs < block.outputStartTimeMs || currentTimeMs > block.outputEndTimeMs) continue;

        for (const item of block.items) {
            // Only skip text when being edited (rendered via HTML for inline editing).
            // Blur, arrow, and border always paint — the HTML overlay only shows
            // bounding box handles, not the visual itself.
            if (editingItemId && item.id === editingItemId && item.type === 'text') continue;

            drawOverlayItem(ctx, item, outputSize);
        }
    }
}

function drawOverlayItem(ctx: CanvasRenderingContext2D, item: OverlayItem, outputSize: Size): void {
    switch (item.type) {
        case 'blur': return drawBlur(ctx, item, outputSize);
        case 'text': return drawText(ctx, item);
        case 'arrow': return drawArrow(ctx, item);
        case 'border': return drawBorder(ctx, item);
    }
}

// ============================================================================
// BLUR
// ============================================================================

function drawBlur(ctx: CanvasRenderingContext2D, item: BlurOverlayItem, _outputSize: Size): void {
    const { rectPx, blurRadiusPx, borderRadiusPx } = item;

    ctx.save();

    // Create clipping path with border radius (restricts visible output)
    ctx.beginPath();
    if (ctx.roundRect) {
        ctx.roundRect(rectPx.x, rectPx.y, rectPx.width, rectPx.height, borderRadiusPx);
    } else {
        ctx.rect(rectPx.x, rectPx.y, rectPx.width, rectPx.height);
    }
    ctx.clip();

    // Apply blur filter
    ctx.filter = `blur(${blurRadiusPx}px)`;

    // Expand source area by blur radius so the kernel has real pixel data at the edges.
    // Without this, the blur fades out at the edges (sampling transparent pixels).
    const expand = blurRadiusPx * 2;
    const sx = Math.max(0, rectPx.x - expand);
    const sy = Math.max(0, rectPx.y - expand);
    const sw = rectPx.width + expand * 2;
    const sh = rectPx.height + expand * 2;

    const canvas = ctx.canvas;
    ctx.drawImage(canvas, sx, sy, sw, sh, sx, sy, sw, sh);

    ctx.filter = 'none';
    ctx.restore();
}

// ============================================================================
// TEXT
// ============================================================================

function drawText(ctx: CanvasRenderingContext2D, item: TextOverlayItem): void {
    const { topLeft, widthPx, text, fontSizePx, fontFamily, fontWeight, color } = item;

    ctx.save();

    const font = `${fontWeight} ${fontSizePx}px ${fontFamily}, sans-serif`;
    ctx.font = font;
    ctx.textBaseline = 'top';

    // Match HTML line-height: 1.2
    const LINE_HEIGHT = 1.2;
    const halfLeading = fontSizePx * (LINE_HEIGHT - 1) / 2;
    const lineHeightPx = fontSizePx * LINE_HEIGHT;

    // Word-wrap text within widthPx
    const lines = wrapLines(ctx, text, widthPx);
    const totalHeight = lines.length * lineHeightPx;

    // Background
    if (item.backgroundColor) {
        const pad = item.backgroundPaddingPx ?? 8;
        const radius = item.backgroundRadiusPx ?? 0;

        ctx.fillStyle = item.backgroundColor;
        ctx.beginPath();
        if (ctx.roundRect) {
            ctx.roundRect(topLeft.x - pad, topLeft.y - pad, widthPx + pad * 2, totalHeight + pad * 2, radius);
        } else {
            ctx.rect(topLeft.x - pad, topLeft.y - pad, widthPx + pad * 2, totalHeight + pad * 2);
        }
        ctx.fill();
    }

    // Shadow
    if (item.shadow) {
        ctx.shadowColor = item.shadow.color;
        ctx.shadowBlur = item.shadow.blurPx;
        ctx.shadowOffsetX = item.shadow.offsetXPx;
        ctx.shadowOffsetY = item.shadow.offsetYPx;
    }

    // Draw each line
    for (let i = 0; i < lines.length; i++) {
        const lineY = topLeft.y + halfLeading + i * lineHeightPx;

        if (item.strokeColor && item.strokeWidthPx > 0) {
            ctx.strokeStyle = item.strokeColor;
            ctx.lineWidth = item.strokeWidthPx;
            ctx.strokeText(lines[i], topLeft.x, lineY);
        }

        ctx.fillStyle = color;
        ctx.fillText(lines[i], topLeft.x, lineY);
    }

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

function drawArrow(ctx: CanvasRenderingContext2D, item: ArrowOverlayItem): void {
    const { tail, head, strokeWidthPx, color, headScale } = item;

    ctx.save();

    // Shadow
    if (item.shadow) {
        ctx.shadowColor = item.shadow.color;
        ctx.shadowBlur = item.shadow.blurPx;
        ctx.shadowOffsetX = item.shadow.offsetXPx;
        ctx.shadowOffsetY = item.shadow.offsetYPx;
    } else if (item.glow && item.glow.blurPx > 0) {
        ctx.shadowColor = item.glow.color;
        ctx.shadowBlur = item.glow.blurPx;
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

    // Arrowhead size
    const headSize = strokeWidthPx * 4 * headScale;

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

function drawBorder(ctx: CanvasRenderingContext2D, item: BorderOverlayItem): void {
    const { rectPx, borderWidthPx, color, borderRadiusPx } = item;

    ctx.save();

    // Shadow / Glow
    if (item.shadow) {
        ctx.shadowColor = item.shadow.color;
        ctx.shadowBlur = item.shadow.blurPx;
        ctx.shadowOffsetX = item.shadow.offsetXPx;
        ctx.shadowOffsetY = item.shadow.offsetYPx;
    } else if (item.glow && item.glow.blurPx > 0) {
        ctx.shadowColor = item.glow.color;
        ctx.shadowBlur = item.glow.blurPx;
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
