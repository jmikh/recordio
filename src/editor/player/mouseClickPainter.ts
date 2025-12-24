import type { MouseEvent, Rect } from '../../core/types';
import type { ViewMapper } from '../../core/effects/viewMapper';

/**
 * Draws click effects.
 *
 * @param ctx 2D Canvas Context
 * @param events List of click events
 * @param currentTime Current Source Time
 * @param viewport Current Viewport (Output Space)
 * @param viewMapper Transformation Wrapper
 */
export function paintMouseClicks(
    ctx: CanvasRenderingContext2D,
    events: MouseEvent[],
    currentTime: number,
    viewport: Rect,
    viewMapper: ViewMapper
) {
    // Show clicks that happened recently (e.g. within last 500ms)
    const CLICK_DURATION = 500;
    const MOUSE_BASE_RADIUS = 60;

    // Calculate current zoom scale
    const zoomScale = viewMapper.getZoomScale(viewport);

    // Optimisation: We could binary search if sorted, but linear fits for small event counts
    for (const click of events) {
        if (currentTime >= click.timestamp && currentTime <= click.timestamp + CLICK_DURATION) {
            const elapsed = currentTime - click.timestamp;
            const progress = elapsed / CLICK_DURATION;

            // Project Center (Input -> Screen)
            const center = viewMapper.projectToScreen(click, viewport);

            // Draw Expanding Expanding Circle
            // Scale radius by zoom level
            const currentRadius = MOUSE_BASE_RADIUS * zoomScale * progress;
            const opacity = 0.5 * (1 - progress);

            ctx.beginPath();
            ctx.arc(center.x, center.y, currentRadius, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(128, 128, 128, ${opacity})`;
            ctx.fill();
        }
    }
}
