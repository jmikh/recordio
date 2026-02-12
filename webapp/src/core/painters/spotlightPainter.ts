import type { Size, Rect } from '../../types';
import type { SpotlightState } from '../spotlight/spotlightMotion';

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

    const { isVisible, originalRect, scaledRect, borderRadius, dimOpacity, scale } = spotlightState;
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

    // borderRadius is already in OUTPUT coordinates
    const radiusPx = borderRadius;

    // Snapshot the spotlight region BEFORE dimming so the enlarged
    // content does not include the dim overlay.
    let snapshot: ImageData | null = null;
    if (sourceCanvas && scale > 1.0 && scaledRect) {
        // Clamp to canvas bounds to avoid getImageData errors
        const sx = Math.max(0, Math.round(originalRect.x));
        const sy = Math.max(0, Math.round(originalRect.y));
        const sw = Math.min(Math.round(originalRect.width), sourceCanvas.width - sx);
        const sh = Math.min(Math.round(originalRect.height), sourceCanvas.height - sy);
        if (sw > 0 && sh > 0) {
            snapshot = ctx.getImageData(sx, sy, sw, sh);
        }
    }

    // Draw dim overlay with cut-out for spotlight
    ctx.save();
    ctx.fillStyle = dimColor;

    // Top rectangle (full width, from top to spotlight top)
    if (originalRect.y > 0) {
        ctx.fillRect(0, 0, outputSize.width, originalRect.y);
    }

    // Bottom rectangle (full width, from spotlight bottom to canvas bottom)
    const bottomY = originalRect.y + originalRect.height;
    if (bottomY < outputSize.height) {
        ctx.fillRect(0, bottomY, outputSize.width, outputSize.height - bottomY);
    }

    // Left rectangle (from spotlight top to bottom, left edge to spotlight left)
    if (originalRect.x > 0) {
        ctx.fillRect(0, originalRect.y, originalRect.x, originalRect.height);
    }

    // Right rectangle (from spotlight top to bottom, spotlight right to canvas right)
    const rightX = originalRect.x + originalRect.width;
    if (rightX < outputSize.width) {
        ctx.fillRect(rightX, originalRect.y, outputSize.width - rightX, originalRect.height);
    }

    // Fill corner areas for rounded corners (if any corner has radius)
    const hasRoundedCorners = radiusPx.some(r => r > 0);
    if (hasRoundedCorners) {
        drawCornerFillsMultiRadius(ctx, originalRect, radiusPx, dimColor);
    }

    ctx.restore();

    // Draw scaled spotlight content from the snapshot
    if (snapshot && scale > 1.0 && scaledRect) {
        drawScaledCanvasContent(ctx, snapshot, originalRect, scaledRect, scale, radiusPx);
    }
}

/**
 * Draws the spotlight content scaled up from the center using a canvas snapshot.
 * Uses an offscreen bitmap to scale the snapshot and clips to the spotlight region.
 */
function drawScaledCanvasContent(
    ctx: CanvasRenderingContext2D,
    snapshot: ImageData,
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
    // Use a temporary canvas to convert ImageData → drawable source
    const tmpCanvas = new OffscreenCanvas(snapshot.width, snapshot.height);
    const tmpCtx = tmpCanvas.getContext('2d')!;
    tmpCtx.putImageData(snapshot, 0, 0);

    ctx.drawImage(tmpCanvas, Math.round(originalRect.x), Math.round(originalRect.y));

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

/**
 * Fills the corner areas that appear when the spotlight has rounded corners.
 * Supports 4 independent corner radii [topLeft, topRight, bottomRight, bottomLeft].
 */
function drawCornerFillsMultiRadius(
    ctx: CanvasRenderingContext2D,
    rect: { x: number; y: number; width: number; height: number },
    radii: [number, number, number, number],
    fillColor: string
): void {
    ctx.fillStyle = fillColor;

    const maxRadius = Math.min(rect.width / 2, rect.height / 2);
    const [tl, tr, br, bl] = radii.map(r => Math.min(r, maxRadius)) as [number, number, number, number];

    // Top-left corner
    if (tl > 0) {
        fillCornerWithRadius(ctx, rect.x, rect.y, tl, 'top-left');
    }
    // Top-right corner
    if (tr > 0) {
        fillCornerWithRadius(ctx, rect.x + rect.width - tr, rect.y, tr, 'top-right');
    }
    // Bottom-left corner
    if (bl > 0) {
        fillCornerWithRadius(ctx, rect.x, rect.y + rect.height - bl, bl, 'bottom-left');
    }
    // Bottom-right corner
    if (br > 0) {
        fillCornerWithRadius(ctx, rect.x + rect.width - br, rect.y + rect.height - br, br, 'bottom-right');
    }
}

/**
 * Fills a single corner region (the area between the sharp corner and the arc).
 */
function fillCornerWithRadius(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    radius: number,
    corner: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
): void {
    ctx.beginPath();

    switch (corner) {
        case 'top-left':
            ctx.moveTo(x, y);
            ctx.lineTo(x + radius, y);
            ctx.arc(x + radius, y + radius, radius, -Math.PI / 2, Math.PI, true);
            ctx.lineTo(x, y);
            break;

        case 'top-right':
            ctx.moveTo(x + radius, y);
            ctx.lineTo(x, y);
            ctx.arc(x, y + radius, radius, -Math.PI / 2, 0, false);
            ctx.lineTo(x + radius, y);
            break;

        case 'bottom-left':
            ctx.moveTo(x, y + radius);
            ctx.lineTo(x, y);
            ctx.arc(x + radius, y, radius, Math.PI, Math.PI / 2, true);
            ctx.lineTo(x, y + radius);
            break;

        case 'bottom-right':
            ctx.moveTo(x + radius, y + radius);
            ctx.lineTo(x + radius, y);
            ctx.arc(x, y, radius, 0, Math.PI / 2, false);
            ctx.lineTo(x + radius, y + radius);
            break;
    }

    ctx.closePath();
    ctx.fill();
}
