import type { Size, Rect } from '../../types';
import type { SpotlightState } from '../spotlight/spotlightAnimator';

// Cached offscreen canvas for spotlight snapshots (avoids per-frame allocation)
let _snapshotCanvas: OffscreenCanvas | null = null;
let _snapshotCtx: OffscreenCanvasRenderingContext2D | null = null;

/**
 * Draws the spotlight overlay effect on the canvas.
 * 
 * The effect consists of:
 * 1. Snapshot the spotlight region from the current canvas (capturing all previously painted layers)
 * 2. A semi-transparent dark overlay covering the entire canvas (ALWAYS when spotlight is active)
 * 3. A "cut out" region where the spotlight is (ONLY if spotlight is visible in viewport)
 * 4. The snapshotted content drawn back scaled into the spotlight region
 * 
 * Because the spotlight samples what's already on the canvas, all effects (mouse clicks,
 * drags, debug overlays) are captured in the enlarged spotlight region.
 * 
 * If the spotlight region is outside the current viewport:
 * - Dimming still applies (entire screen is dimmed)
 * - No hole is cut out
 * - No enlarged content is rendered
 * 
 * @param ctx - Canvas rendering context
 * @param spotlightState - Current spotlight state (null = no spotlight)
 * @param outputSize - Canvas dimensions
 * @param sourceCanvas - The canvas to sample existing content from for the enlarged region
 */
export function drawSpotlight(
    ctx: CanvasRenderingContext2D,
    spotlightState: SpotlightState | null,
    outputSize: Size,
    sourceCanvas?: HTMLCanvasElement | OffscreenCanvas
): void {
    // Skip if no spotlight state OR if there's no visual effect at all
    // (dimOpacity = 0 means no dimming, scale = 1 means no enlargement)
    if (!spotlightState || (spotlightState.dimOpacity <= 0 && spotlightState.scale <= 1)) {
        return;
    }

    const { isVisible, originalRect, scaledRect, borderRadiusPx, dimOpacity, scale } = spotlightState;
    const dimColor = `rgba(0, 0, 0, ${dimOpacity})`;

    // =========================================================
    // CASE 1: Spotlight NOT visible in viewport
    // Just dim the entire screen
    // =========================================================
    if (!isVisible || !originalRect) {
        ctx.save();
        ctx.fillStyle = dimColor;
        ctx.fillRect(0, 0, outputSize.width, outputSize.height);
        ctx.restore();
        return;
    }

    // =========================================================
    // CASE 2: Spotlight IS visible
    // Snapshot → Dim with cut-out → Draw scaled content
    // =========================================================

    // borderRadiusPx is already in OUTPUT coordinates
    const radiusPx = borderRadiusPx;

    // Snapshot the spotlight region BEFORE dimming using GPU-side drawImage
    // (avoids expensive getImageData GPU→CPU readback)
    // Always snapshot when visible so we can restore content over the dim
    let hasSnapshot = false;
    if (sourceCanvas) {
        const sx = Math.max(0, Math.round(originalRect.x));
        const sy = Math.max(0, Math.round(originalRect.y));
        const sw = Math.min(Math.round(originalRect.width), (sourceCanvas.width || 0) - sx);
        const sh = Math.min(Math.round(originalRect.height), (sourceCanvas.height || 0) - sy);
        if (sw > 0 && sh > 0) {
            // Reuse or create the cached offscreen canvas
            if (!_snapshotCanvas || _snapshotCanvas.width !== sw || _snapshotCanvas.height !== sh) {
                _snapshotCanvas = new OffscreenCanvas(sw, sh);
                _snapshotCtx = _snapshotCanvas.getContext('2d');
            }
            if (_snapshotCtx) {
                _snapshotCtx.clearRect(0, 0, sw, sh);
                _snapshotCtx.drawImage(sourceCanvas, sx, sy, sw, sh, 0, 0, sw, sh);
                hasSnapshot = true;
            }
        }
    }

    // Step 1: Dim the ENTIRE canvas (no cut-outs, no seams)
    ctx.save();
    ctx.fillStyle = dimColor;
    ctx.fillRect(0, 0, outputSize.width, outputSize.height);
    ctx.restore();

    // Step 2: Draw spotlight content back on top of the dimmed canvas
    if (hasSnapshot && _snapshotCanvas) {
        if (scale > 1.0 && scaledRect) {
            // Enlarged: draw scaled content
            drawScaledCanvasContent(ctx, _snapshotCanvas, originalRect, scaledRect, scale, radiusPx);
        } else {
            // No scaling: restore original content in the spotlight region
            drawRestoredContent(ctx, _snapshotCanvas, originalRect, radiusPx);
        }
    }
}

/**
 * Draws the spotlight content scaled up from the center using a canvas snapshot.
 * Uses the cached offscreen canvas directly (no ImageData conversion needed).
 */
function drawScaledCanvasContent(
    ctx: CanvasRenderingContext2D,
    snapshotCanvas: OffscreenCanvas,
    originalRect: Rect,
    scaledRect: Rect,
    scale: number,
    radiusPx: [number, number, number, number]
): void {
    // Calculate spotlight center (from original rect)
    const cx = originalRect.x + originalRect.width / 2;
    const cy = originalRect.y + originalRect.height / 2;

    ctx.save();

    // Create clipping path for scaled spotlight region (with rounded corners)
    ctx.beginPath();

    const hasRoundedCorners = radiusPx.some(r => r > 0);
    if (hasRoundedCorners) {
        // Scale each corner radius proportionally
        const scaledRadii: [number, number, number, number] = [
            radiusPx[0] * scale,
            radiusPx[1] * scale,
            radiusPx[2] * scale,
            radiusPx[3] * scale
        ];
        if (ctx.roundRect) {
            ctx.roundRect(scaledRect.x, scaledRect.y, scaledRect.width, scaledRect.height, scaledRadii);
        } else {
            drawRoundedRectPathMultiRadius(ctx, scaledRect.x, scaledRect.y, scaledRect.width, scaledRect.height, scaledRadii);
        }
    } else {
        ctx.rect(scaledRect.x, scaledRect.y, scaledRect.width, scaledRect.height);
    }
    ctx.clip();

    // Apply scale transform from spotlight center
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);
    ctx.translate(-cx, -cy);

    // Draw the snapshot back at the original position (the transform scales it up)
    ctx.drawImage(snapshotCanvas, Math.round(originalRect.x), Math.round(originalRect.y));

    ctx.restore();
}

/**
 * Restores the spotlight content at 1:1 scale over the dimmed canvas.
 * Clips to rounded corners so the dim overlay is visible outside the spotlight.
 */
function drawRestoredContent(
    ctx: CanvasRenderingContext2D,
    snapshotCanvas: OffscreenCanvas,
    originalRect: Rect,
    radiusPx: [number, number, number, number]
): void {
    ctx.save();

    // Clip to the spotlight shape (with rounded corners)
    ctx.beginPath();
    const hasRoundedCorners = radiusPx.some(r => r > 0);
    if (hasRoundedCorners) {
        if (ctx.roundRect) {
            ctx.roundRect(originalRect.x, originalRect.y, originalRect.width, originalRect.height, radiusPx);
        } else {
            drawRoundedRectPathMultiRadius(ctx, originalRect.x, originalRect.y, originalRect.width, originalRect.height, radiusPx);
        }
    } else {
        ctx.rect(originalRect.x, originalRect.y, originalRect.width, originalRect.height);
    }
    ctx.clip();

    // Draw the snapshot back at the original position
    ctx.drawImage(snapshotCanvas, Math.round(originalRect.x), Math.round(originalRect.y));

    ctx.restore();
}

/**
 * Fallback for drawing rounded rectangle path with 4 independent corner radii.
 * Uses arcTo for true circular arcs matching CSS border-radius.
 * Radii order: [topLeft, topRight, bottomRight, bottomLeft]
 */
function drawRoundedRectPathMultiRadius(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    radii: [number, number, number, number]
): void {
    const [tl, tr, br, bl] = radii;

    // Start at top-left, after the corner arc
    ctx.moveTo(x + tl, y);

    // Top edge and top-right corner
    ctx.lineTo(x + width - tr, y);
    ctx.arcTo(x + width, y, x + width, y + tr, tr);

    // Right edge and bottom-right corner
    ctx.lineTo(x + width, y + height - br);
    ctx.arcTo(x + width, y + height, x + width - br, y + height, br);

    // Bottom edge and bottom-left corner
    ctx.lineTo(x + bl, y + height);
    ctx.arcTo(x, y + height, x, y + height - bl, bl);

    // Left edge and top-left corner
    ctx.lineTo(x, y + tl);
    ctx.arcTo(x, y, x + tl, y, tl);

    ctx.closePath();
}
