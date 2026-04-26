import type { Size, Rect } from '../types';
import type { SpotlightState } from '../animators/spotlightAnimator';
import type { RenderContext, CanvasHandle } from '../utils/renderContext';
import { roundRectPath } from './utils/roundRect';

// Cached offscreen canvas for spotlight snapshots (avoids per-frame allocation)
let _snapshot: CanvasHandle | null = null;

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
    sourceCanvas?: CanvasImageSource & Size,
    renderCtx?: RenderContext
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
    if (sourceCanvas && renderCtx) {
        const sx = Math.max(0, Math.round(originalRect.x));
        const sy = Math.max(0, Math.round(originalRect.y));
        const sw = Math.min(Math.round(originalRect.width), (sourceCanvas.width || 0) - sx);
        const sh = Math.min(Math.round(originalRect.height), (sourceCanvas.height || 0) - sy);
        if (sw > 0 && sh > 0) {
            // Reuse or create the cached offscreen canvas
            if (!_snapshot || _snapshot.canvas.width !== sw || _snapshot.canvas.height !== sh) {
                _snapshot = renderCtx.createCanvas(sw, sh);
            }
            _snapshot.ctx.clearRect(0, 0, sw, sh);
            _snapshot.ctx.drawImage(sourceCanvas, sx, sy, sw, sh, 0, 0, sw, sh);
            hasSnapshot = true;
        }
    }

    // Step 1: Dim the ENTIRE canvas (no cut-outs, no seams)
    ctx.save();
    ctx.fillStyle = dimColor;
    ctx.fillRect(0, 0, outputSize.width, outputSize.height);
    ctx.restore();

    // Step 2: Draw spotlight content back on top of the dimmed canvas
    if (hasSnapshot && _snapshot) {
        if (scale > 1.0 && scaledRect) {
            // Enlarged: draw scaled content
            drawScaledCanvasContent(ctx, _snapshot.canvas, originalRect, scaledRect, scale, radiusPx);
        } else {
            // No scaling: restore original content in the spotlight region
            drawRestoredContent(ctx, _snapshot.canvas, originalRect, radiusPx);
        }
    }
}

/**
 * Draws the spotlight content scaled up from the center using a canvas snapshot.
 * Uses the cached offscreen canvas directly (no ImageData conversion needed).
 */
function drawScaledCanvasContent(
    ctx: CanvasRenderingContext2D,
    snapshotCanvas: CanvasImageSource,
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
    const hasRoundedCorners = radiusPx.some(r => r > 0);
    if (hasRoundedCorners) {
        // Scale each corner radius proportionally
        const scaledRadii: [number, number, number, number] = [
            radiusPx[0] * scale,
            radiusPx[1] * scale,
            radiusPx[2] * scale,
            radiusPx[3] * scale
        ];
        roundRectPath(ctx, scaledRect.x, scaledRect.y, scaledRect.width, scaledRect.height, scaledRadii);
    } else {
        ctx.beginPath();
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
    snapshotCanvas: CanvasImageSource,
    originalRect: Rect,
    radiusPx: [number, number, number, number]
): void {
    ctx.save();

    // Clip to the spotlight shape (with rounded corners)
    const hasRoundedCorners = radiusPx.some(r => r > 0);
    if (hasRoundedCorners) {
        roundRectPath(ctx, originalRect.x, originalRect.y, originalRect.width, originalRect.height, radiusPx);
    } else {
        ctx.beginPath();
        ctx.rect(originalRect.x, originalRect.y, originalRect.width, originalRect.height);
    }
    ctx.clip();

    // Draw the snapshot back at the original position
    ctx.drawImage(snapshotCanvas, Math.round(originalRect.x), Math.round(originalRect.y));

    ctx.restore();
}

