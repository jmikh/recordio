import type { Rect, FocusArea } from '../types';
import type { ViewMapper } from '../viewMapper';

/**
 * DEBUG PAINTER - Throwaway code for visualizing FocusAreas
 * 
 * Paints the current focus area as a rectangle with the reason string inside.
 * Each focus area stays visible until the next one begins.
 */
export function paintZoomDebug(
    ctx: CanvasRenderingContext2D,
    focusAreas: FocusArea[],
    currentTime: number,
    viewport: Rect,
    viewMapper: ViewMapper
) {
    if (focusAreas.length === 0) return;

    // Find the current focus area (the last one whose timestamp <= currentTime)
    let currentFocusArea: FocusArea | null = null;
    for (let i = focusAreas.length - 1; i >= 0; i--) {
        if (focusAreas[i].timestamp <= currentTime) {
            currentFocusArea = focusAreas[i];
            break;
        }
    }

    if (!currentFocusArea) return;

    // Project the focus rect corners to screen coordinates
    const focusRect = currentFocusArea.rect;
    const topLeft = viewMapper.projectToScreen({ x: focusRect.x, y: focusRect.y }, viewport);
    const bottomRight = viewMapper.projectToScreen(
        { x: focusRect.x + focusRect.width, y: focusRect.y + focusRect.height },
        viewport
    );

    const screenRect: Rect = {
        x: topLeft.x,
        y: topLeft.y,
        width: bottomRight.x - topLeft.x,
        height: bottomRight.y - topLeft.y,
    };

    // Draw rectangle outline
    ctx.strokeStyle = 'rgba(255, 0, 255, 0.8)'; // Magenta
    ctx.lineWidth = 3;
    ctx.setLineDash([10, 5]); // Dashed line
    ctx.strokeRect(screenRect.x, screenRect.y, screenRect.width, screenRect.height);
    ctx.setLineDash([]); // Reset dash

    // Draw semi-transparent fill
    ctx.fillStyle = 'rgba(255, 0, 255, 0.1)';
    ctx.fillRect(screenRect.x, screenRect.y, screenRect.width, screenRect.height);

    // Draw reason text inside the rectangle
    const fontSize = 24;
    ctx.font = `bold ${fontSize}px sans-serif`;
    ctx.fillStyle = 'rgba(255, 0, 255, 1)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const centerX = screenRect.x + screenRect.width / 2;
    const centerY = screenRect.y + screenRect.height / 2;

    // Draw text with background for readability
    const text = currentFocusArea.reason;
    const textMetrics = ctx.measureText(text);
    const padding = 8;
    const bgWidth = textMetrics.width + padding * 2;
    const bgHeight = fontSize + padding * 2;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(centerX - bgWidth / 2, centerY - bgHeight / 2, bgWidth, bgHeight);

    ctx.fillStyle = 'rgba(255, 0, 255, 1)';
    ctx.fillText(text, centerX, centerY);

    // Draw timestamp in corner
    const timestampText = `t=${currentFocusArea.timestamp.toFixed(0)}ms`;
    ctx.font = `${fontSize * 0.6}px sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(255, 0, 255, 0.8)';
    ctx.fillText(timestampText, screenRect.x + 5, screenRect.y + 5);
}
