import type { DragEvent, Point, Rect, BaseEvent, UserEvents } from '../types';
import type { ViewMapper } from '../viewMapper';

/**
 * Extracts the mouse positions that fall within the drag time range.
 * Uses the start position from the drag event and the end position from the last mouse position in range.
 */
function getDragPath(
    drag: DragEvent,
    mousePositions: BaseEvent[]
): BaseEvent[] {
    // Start with the drag's initial position
    const path: BaseEvent[] = [{
        type: 'mousepos' as const,
        timestamp: drag.timestamp,
        mousePos: drag.mousePos
    }];

    // Find mouse positions within the drag time range
    for (const pos of mousePositions) {
        if (pos.timestamp > drag.timestamp && pos.timestamp <= drag.endTime) {
            path.push(pos);
        }
        // Early exit once we're past the drag end time
        if (pos.timestamp > drag.endTime) break;
    }

    return path;
}

/**
 * Draws drag effects.
 *
 * @param ctx 2D Canvas Context
 * @param userEvents User events containing drags and mousePositions
 * @param sourceTimeMs Current Source Time
 * @param viewport Current Viewport (Output Space)
 * @param viewMapper Transformation Wrapper
 */
export function drawDragEffects(
    ctx: CanvasRenderingContext2D,
    userEvents: UserEvents,
    sourceTimeMs: number,
    viewport: Rect,
    viewMapper: ViewMapper
) {
    // Add a visual lag (there is a mismatch between the drag events and the screen events)
    const DRAG_LAG_MS = 80;
    const MOUSE_BASE_RADIUS = 40;

    const { drags, mousePositions } = userEvents;

    for (const drag of drags) {
        const endTimestamp = drag.endTime;

        if (sourceTimeMs >= drag.timestamp && sourceTimeMs <= endTimestamp + DRAG_LAG_MS) {
            // Derive the path from mousePositions
            const path = getDragPath(drag, mousePositions);
            if (path.length === 0) continue;

            // Calculate "Visual Time" (where the cursor appears to be)
            const rawVisualTime = sourceTimeMs - DRAG_LAG_MS;

            // Position is clamped to the drag path
            const positionTime = Math.max(drag.timestamp, Math.min(rawVisualTime, endTimestamp));
            const currentPoint = getPointAtTime(path, positionTime);
            const screenPoint = viewMapper.projectToScreen(currentPoint, viewport);

            // Scale radius by zoom level
            const scaledRadius = MOUSE_BASE_RADIUS;
            const opacity = 0.3;

            // Draw Cursor Representative
            ctx.beginPath();
            ctx.arc(screenPoint.x, screenPoint.y, scaledRadius, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(128, 128, 128, ${opacity})`;
            ctx.fill();
        }
    }
}

function getPointAtTime(path: BaseEvent[], time: number): Point {
    // Find segment [p1, p2] where p1.t <= time <= p2.t
    if (path.length === 0) return { x: 0, y: 0 };
    if (time <= path[0].timestamp) return { x: path[0].mousePos.x, y: path[0].mousePos.y };
    if (time >= path[path.length - 1].timestamp) {
        const last = path[path.length - 1];
        return { x: last.mousePos.x, y: last.mousePos.y };
    }

    for (let i = 0; i < path.length - 1; i++) {
        const p1 = path[i];
        const p2 = path[i + 1];

        if (time >= p1.timestamp && time <= p2.timestamp) {
            const range = p2.timestamp - p1.timestamp;
            const t = range === 0 ? 0 : (time - p1.timestamp) / range;

            return {
                x: p1.mousePos.x + (p2.mousePos.x - p1.mousePos.x) * t,
                y: p1.mousePos.y + (p2.mousePos.y - p1.mousePos.y) * t
            };
        }
    }

    return { x: path[0].mousePos.x, y: path[0].mousePos.y };
}
