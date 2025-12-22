import type { Point, Rect, TimestampedPoint, Recording } from '../../core/types';
import type { ViewTransform } from '../../core/effects/viewTransform';

/**
 * Draws simpler "circle" mouse effects for the editor.
 *
 * @param ctx 2D Canvas Context
 * @param recording Recording containing events
 * @param sourceTimeMs Current Source Time
 * @param viewport Current Viewport (Output Space)
 * @param config Transformation Config
 */
export function drawMouseEffects(
    ctx: CanvasRenderingContext2D,
    recording: Recording,
    sourceTimeMs: number,
    viewport: Rect,
    config: ViewTransform
) {
    const { clickEvents, dragEvents } = recording;

    // 1. Draw Clicks
    // Show clicks that happened recently (e.g. within last 500ms)
    const CLICK_DURATION = 500;

    // Optimisation: We could binary search if sorted, but linear fits for small event counts
    for (const click of clickEvents) {
        if (sourceTimeMs >= click.timestamp && sourceTimeMs <= click.timestamp + CLICK_DURATION) {
            const elapsed = sourceTimeMs - click.timestamp;
            const progress = elapsed / CLICK_DURATION;

            // Project Center (Input -> Screen)
            const center = config.projectToScreen(click, viewport);

            // Draw Expanding Gray Circle
            const maxRadius = 60; // px
            const currentRadius = maxRadius * progress;
            const opacity = 0.5 * (1 - progress);

            ctx.beginPath();
            ctx.arc(center.x, center.y, currentRadius, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(128, 128, 128, ${opacity})`;
            ctx.fill();
        }
    }

    // 2. Draw Drags
    // Show active drag if sourceTimeMs is within drag duration
    // DragEvent doesn't strictly have duration on the root object unless we calculate it from path?
    // The previous DragEvent had start/end timestamps. 
    // New DragEvent extends BaseEvent (timestamp). It has path? path has timestamps.
    // Let's assume drag starts at event.timestamp and ends at last point timestamp.

    for (const drag of dragEvents) {
        if (drag.path.length === 0) continue;

        const endTimestamp = drag.path[drag.path.length - 1].timestamp;

        if (sourceTimeMs >= drag.timestamp && sourceTimeMs <= endTimestamp) {
            // Find current position along path
            const currentPoint = getPointAtTime(drag.path, sourceTimeMs);

            // Project
            const screenPoint = config.projectToScreen(currentPoint, viewport);

            // Draw Cursor Representative
            ctx.beginPath();
            ctx.arc(screenPoint.x, screenPoint.y, 60, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(128, 128, 128, 0.5)';
            ctx.fill();
        }
    }
}

function getPointAtTime(path: TimestampedPoint[], time: number): Point {
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
