import type { DragEvent, Point, Rect, BaseEvent, UserEvents } from '../../types';
import type { MouseSettings } from '../../types/settings';
import type { ViewMapper } from '../mappers/viewMapper';
import type { TimeMapper } from '../mappers/timeMapper';
import { hexToRgba } from './mouseClickPainter';

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
 * Draws drag effects — shows a ring or filled circle (matching the click
 * effect style) at full size for the entire duration of the drag.
 *
 * Event timestamps are source time; they are mapped to output time via timeMapper.
 * Drags in cut/hidden segments are skipped.
 */
export function drawDragEffects(
    ctx: CanvasRenderingContext2D,
    userEvents: UserEvents,
    currentOutputTime: number,
    viewport: Rect,
    viewMapper: ViewMapper,
    settings: MouseSettings,
    timeMapper: TimeMapper
) {
    // Add a visual lag (there is a mismatch between the drag events and the screen events)
    const DRAG_LAG_MS = 80;

    const { drags, mousePositions } = userEvents;
    const [r, g, b, a] = hexToRgba(settings.color);
    const radius = settings.kDragRadiusPx * settings.size;

    for (const drag of drags) {
        // Map the drag's source time range to output time range
        const mappedRange = timeMapper.mapSourceRangeToOutputRange(drag.timestamp, drag.endTime);
        if (!mappedRange) continue; // Drag is entirely in a cut/hidden segment

        const { start: outputStart, end: outputEnd } = mappedRange;

        if (currentOutputTime >= outputStart && currentOutputTime <= outputEnd + DRAG_LAG_MS) {
            // Derive the path from mousePositions
            const path = getDragPath(drag, mousePositions);
            if (path.length === 0) continue;

            // Convert current output time back to source time for position interpolation
            // (mouse positions are in source time)
            const sourceTime = timeMapper.mapOutputToSourceTime(currentOutputTime);
            if (sourceTime < 0) continue;

            // Calculate "Visual Time" (where the cursor appears to be) in source time
            // We apply the lag in output time, then convert back to source
            const laggedOutputTime = Math.max(outputStart, currentOutputTime - DRAG_LAG_MS);
            const laggedSourceTime = timeMapper.mapOutputToSourceTime(laggedOutputTime);
            if (laggedSourceTime < 0) continue;

            // Position is clamped to the drag path (source time)
            const positionTime = Math.max(drag.timestamp, Math.min(laggedSourceTime, drag.endTime));
            const currentPoint = getPointAtTime(path, positionTime);
            const screenPoint = viewMapper.projectEventPointToOutput(currentPoint, viewport);

            // Draw ring or circle at full size (no animation / no fade)
            ctx.beginPath();
            ctx.arc(screenPoint.x, screenPoint.y, radius, 0, Math.PI * 2);

            if (settings.effectType === 'ring') {
                ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${0.7 * a})`;
                ctx.lineWidth = 3;
                ctx.stroke();
            } else {
                // 'circle' — filled
                ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${0.5 * a})`;
                ctx.fill();
            }
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
