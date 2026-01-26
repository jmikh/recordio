import type { Size, Rect, Project } from '../types';
import type { SpotlightState } from '../spotlightMotion';
import { drawScreen } from './screenPainter';
import type { ProjectState } from '../../editor/stores/useProjectStore';

/**
 * Resources needed for rendering the scaled spotlight content.
 */
export interface SpotlightRenderResources {
    video: HTMLVideoElement;
    project: Project;
    sources: ProjectState['sources'];
    effectiveViewport: Rect;
    deviceFrameImg: HTMLImageElement | null;
}

/**
 * Draws the spotlight overlay effect on the canvas.
 * 
 * The effect consists of:
 * 1. A semi-transparent dark overlay covering the entire canvas (ALWAYS when spotlight is active)
 * 2. A "cut out" region where the spotlight is (ONLY if spotlight is visible in viewport)
 * 3. The spotlight content re-rendered at enlargeScale (ONLY if spotlight is visible)
 * 
 * If the spotlight region is outside the current viewport:
 * - Dimming still applies (entire screen is dimmed)
 * - No hole is cut out
 * - No enlarged content is rendered
 * 
 * @param ctx - Canvas rendering context
 * @param spotlightState - Current spotlight state (null = no spotlight)
 * @param outputSize - Canvas dimensions
 * @param renderResources - Optional resources for rendering scaled content
 */
export function drawSpotlight(
    ctx: CanvasRenderingContext2D,
    spotlightState: SpotlightState | null,
    outputSize: Size,
    renderResources?: SpotlightRenderResources
): void {
    if (!spotlightState || spotlightState.dimOpacity <= 0) {
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
    // Draw dim overlay with cut-out hole and scaled content
    // =========================================================

    // Calculate the actual border radius in pixels (based on original rect)
    const minDimension = Math.min(originalRect.width, originalRect.height);
    const radiusPx = (borderRadius / 100) * (minDimension / 2);

    // Save current state
    ctx.save();

    // Draw dim overlay with cut-out for spotlight
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

    // Fill corner areas for rounded corners
    if (radiusPx > 0) {
        drawCornerFills(ctx, originalRect, radiusPx, dimColor);
    }

    ctx.restore();

    // Draw scaled spotlight content (if resources provided and scale > 1)
    if (renderResources && scale > 1.0 && scaledRect) {
        drawScaledSpotlightContent(ctx, originalRect, scaledRect, scale, radiusPx, renderResources);
    }
}

/**
 * Draws the spotlight content scaled up from the center.
 * Uses clipping to only affect the spotlight region.
 */
function drawScaledSpotlightContent(
    ctx: CanvasRenderingContext2D,
    originalRect: Rect,
    scaledRect: Rect,
    scale: number,
    radiusPx: number,
    resources: SpotlightRenderResources
): void {
    const { video, project, sources, effectiveViewport, deviceFrameImg } = resources;

    // Calculate spotlight center (from original rect)
    const cx = originalRect.x + originalRect.width / 2;
    const cy = originalRect.y + originalRect.height / 2;

    ctx.save();

    // Create clipping path for scaled spotlight region (with rounded corners)
    ctx.beginPath();
    if (radiusPx > 0) {
        // Scale the radius proportionally
        const scaledRadiusPx = radiusPx * scale;
        if (ctx.roundRect) {
            ctx.roundRect(scaledRect.x, scaledRect.y, scaledRect.width, scaledRect.height, scaledRadiusPx);
        } else {
            drawRoundedRectPath(ctx, scaledRect.x, scaledRect.y, scaledRect.width, scaledRect.height, scaledRadiusPx);
        }
    } else {
        ctx.rect(scaledRect.x, scaledRect.y, scaledRect.width, scaledRect.height);
    }
    ctx.clip();

    // Apply scale transform from spotlight center
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);
    ctx.translate(-cx, -cy);

    // Re-render screen content (clipped and scaled)
    drawScreen(
        ctx,
        video,
        project,
        sources,
        effectiveViewport,
        deviceFrameImg
    );

    ctx.restore();
}

/**
 * Fallback for drawing rounded rectangle path.
 */
function drawRoundedRectPath(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number
): void {
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
}

/**
 * Fills the corner areas that appear when the spotlight has rounded corners.
 */
function drawCornerFills(
    ctx: CanvasRenderingContext2D,
    rect: { x: number; y: number; width: number; height: number },
    radius: number,
    fillColor: string
): void {
    ctx.fillStyle = fillColor;

    const maxRadius = Math.min(rect.width / 2, rect.height / 2);
    const r = Math.min(radius, maxRadius);

    // Top-left corner
    fillCorner(ctx, rect.x, rect.y, r, 'top-left');
    // Top-right corner
    fillCorner(ctx, rect.x + rect.width - r, rect.y, r, 'top-right');
    // Bottom-left corner
    fillCorner(ctx, rect.x, rect.y + rect.height - r, r, 'bottom-left');
    // Bottom-right corner
    fillCorner(ctx, rect.x + rect.width - r, rect.y + rect.height - r, r, 'bottom-right');
}

/**
 * Fills a single corner region (the area between the sharp corner and the arc).
 */
function fillCorner(
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
