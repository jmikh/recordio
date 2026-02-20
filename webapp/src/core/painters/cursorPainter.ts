import type { BaseEvent, Point, Rect, Size } from '../../types';
import type { ViewMapper } from '../mappers/viewMapper';
import type { TimeMapper } from '../mappers/timeMapper';

// ══════════════════════════════════════════
// Reference Constants (designed for 1080px height)
// ══════════════════════════════════════════

const REF_OUTPUT_HEIGHT = 1080;

/**
 * Base cursor size at reference resolution (1080p).
 * The cursor path is drawn in a 24×24 viewBox and scaled by this factor.
 */
const REF_CURSOR_SIZE = 24;

// ── Position interpolation ──────────────────────────────────

/**
 * Returns the interpolated mouse position at a given source time.
 * Linearly interpolates between the two closest bracketing mouse-position events.
 */
function getMousePosAtTime(positions: BaseEvent[], sourceTime: number): Point | null {
    if (positions.length === 0) return null;
    if (sourceTime <= positions[0].timestamp) return positions[0].mousePos;
    if (sourceTime >= positions[positions.length - 1].timestamp) return positions[positions.length - 1].mousePos;

    for (let i = 0; i < positions.length - 1; i++) {
        const a = positions[i];
        const b = positions[i + 1];
        if (sourceTime >= a.timestamp && sourceTime <= b.timestamp) {
            const range = b.timestamp - a.timestamp;
            const t = range === 0 ? 0 : (sourceTime - a.timestamp) / range;
            return {
                x: a.mousePos.x + (b.mousePos.x - a.mousePos.x) * t,
                y: a.mousePos.y + (b.mousePos.y - a.mousePos.y) * t,
            };
        }
    }

    return positions[0].mousePos;
}

// ── Cursor drawing ──────────────────────────────────────────

/**
 * Draws a standard arrow-pointer cursor at (x, y).
 * The cursor is drawn using a canvas path matching a classic macOS pointer shape.
 */
function drawCursorIcon(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    scale: number
) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);

    // Arrow cursor path (tip at 0,0 — standard pointer shape)
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, 17);
    ctx.lineTo(4.4, 13.3);
    ctx.lineTo(7.8, 20);
    ctx.lineTo(10.5, 18.7);
    ctx.lineTo(7, 12);
    ctx.lineTo(12, 12);
    ctx.closePath();

    // White fill with black stroke for visibility on any background
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1;
    ctx.lineJoin = 'round';
    ctx.stroke();

    ctx.restore();
}

// ── Public API ──────────────────────────────────────────────

/**
 * Paints a cursor icon at the current mouse position on screen.
 *
 * @param cursorSize - size multiplier (0 = disabled, 1 = default). Stored in MouseSettings.cursorSize.
 */
export function paintCursor(
    ctx: CanvasRenderingContext2D,
    mousePositions: BaseEvent[],
    currentOutputTime: number,
    viewport: Rect,
    viewMapper: ViewMapper,
    cursorSize: number,
    timeMapper: TimeMapper,
    outputSize: Size
) {
    if (cursorSize <= 0 || mousePositions.length === 0) return;

    // Convert current output time to source time for position lookup
    const sourceTime = timeMapper.mapOutputToSourceTime(currentOutputTime);
    if (sourceTime < 0) return;

    const pos = getMousePosAtTime(mousePositions, sourceTime);
    if (!pos) return;

    // Project from source (video coords) to output (canvas coords)
    const screenPoint = viewMapper.projectEventPointToOutput(pos, viewport);

    // Scale cursor size relative to the reference resolution
    const resScale = outputSize.height / REF_OUTPUT_HEIGHT;
    const finalScale = resScale * cursorSize;

    drawCursorIcon(ctx, screenPoint.x, screenPoint.y, finalScale);
}
