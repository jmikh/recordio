import type { MouseEffect, Point, Rect } from '../../core/types';
import type { ViewTransform } from '../../core/effects/viewTransform';

/**
 * Draws simpler "circle" mouse effects for the editor.
 *
 * @param ctx 2D Canvas Context
 * @param effects List of mouse effects to draw
 * @param currentTimeMs Current playback time
 * @param cameraWindow Current Camera Window (Output Space)
 * @param config Transformation Config
 */
export function drawMouseEffects(
    ctx: CanvasRenderingContext2D,
    effects: MouseEffect[],
    currentTimeMs: number,
    viewport: Rect, // Current Viewport (Output Space)
    config: ViewTransform // Transformation Config
) {
    // Draw Clicks
    // Draw active Drags

    const activeEffects = effects.filter(e => currentTimeMs >= e.timeInMs && currentTimeMs <= e.timeOutMs);

    for (const effect of activeEffects) {
        if (effect.type === 'click') {
            const elapsed = currentTimeMs - effect.timeInMs;
            const duration = effect.timeOutMs - effect.timeInMs;
            const progress = Math.min(1, Math.max(0, elapsed / duration));

            // Project Center (Input -> Screen)
            const center = config.projectToScreen(effect.start, viewport);

            // Draw Ripple
            const maxRadius = 40; // px
            const currentRadius = maxRadius * progress;
            const opacity = 1 - progress;

            ctx.beginPath();
            ctx.arc(center.x, center.y, currentRadius, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(255, 200, 0, ${opacity})`;
            ctx.lineWidth = 4;
            ctx.stroke();

            // Inner dot
            ctx.beginPath();
            ctx.arc(center.x, center.y, 5, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(255, 200, 0, ${opacity})`;
            ctx.fill();
        }
        else if (effect.type === 'drag') {
            // Find current position along path
            if (effect.path && effect.path.length > 0) {
                // Find point in path closest to current time (or interpolated)
                const currentPoint = getPointAtTime(effect.path, currentTimeMs);

                // Project
                const screenPoint = config.projectToScreen(currentPoint, viewport);

                // Draw Cursor Representative
                ctx.beginPath();
                ctx.arc(screenPoint.x, screenPoint.y, 8, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(0, 150, 255, 0.8)';
                ctx.fill();
                ctx.strokeStyle = 'white';
                ctx.lineWidth = 2;
                ctx.stroke();

                // Optional: Draw Trail?
            }
        }
    }
}

function getPointAtTime(path: { timestamp: number; x: number; y: number }[], time: number): Point {
    // Find segment [p1, p2] where p1.t <= time <= p2.t
    if (path.length === 0) return { x: 0, y: 0 };
    if (time <= path[0].timestamp) return { x: path[0].x, y: path[0].y };
    if (time >= path[path.length - 1].timestamp) {
        const last = path[path.length - 1];
        return { x: last.x, y: last.y };
    }

    for (let i = 0; i < path.length - 1; i++) {
        const p1 = path[i];
        const p2 = path[i + 1];

        if (time >= p1.timestamp && time <= p2.timestamp) {
            const range = p2.timestamp - p1.timestamp;
            const t = range === 0 ? 0 : (time - p1.timestamp) / range;

            return {
                x: p1.x + (p2.x - p1.x) * t,
                y: p1.y + (p2.y - p1.y) * t
            };
        }
    }

    return { x: path[0].x, y: path[0].y };
}
