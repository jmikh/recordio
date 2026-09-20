import type { Rect, Size, FocusArea } from '../types';
import type { ViewMapper } from '../mappers/viewMapper';

/**
 * DEBUG PAINTER — visualizes the FocusAreas that drive auto-zoom.
 *
 * Paints the focus area covering the current source time as a dashed magenta
 * rectangle labelled with its `reason` and source time range. Focus areas for
 * instant events (clicks, URL changes) have sourceStartTimeMs === sourceEndTimeMs,
 * so the most recent past area stays on screen (drawn dimmer) until the next one
 * begins — otherwise it would flash for a single frame.
 *
 * Only rendered when the DebugBar's "Overlays" toggle is on.
 */

const ACCENT = '255, 0, 255'; // magenta

export function paintFocusAreaDebug(
    ctx: CanvasRenderingContext2D,
    focusAreas: FocusArea[],
    sourceTimeMs: number,
    viewport: Rect,
    viewMapper: ViewMapper,
    outputSize: Size
) {
    if (focusAreas.length === 0) return;

    // Focus areas are pre-sorted by source time: the last one that has started is
    // the one in effect now.
    let current: FocusArea | null = null;
    for (let i = focusAreas.length - 1; i >= 0; i--) {
        if (focusAreas[i].sourceStartTimeMs <= sourceTimeMs) {
            current = focusAreas[i];
            break;
        }
    }
    if (!current) return;

    const isActive = sourceTimeMs <= current.sourceEndTimeMs;

    // Focus rects live in event coordinates (same space autoZoom maps from).
    const screenRect = viewMapper.projectEventToOutput(current.rect, viewport);

    ctx.save();

    // Outline + translucent fill
    ctx.strokeStyle = `rgba(${ACCENT}, ${isActive ? 0.9 : 0.45})`;
    ctx.lineWidth = Math.max(2, outputSize.height * 0.003);
    ctx.setLineDash(isActive ? [] : [10, 6]);
    ctx.strokeRect(screenRect.x, screenRect.y, screenRect.width, screenRect.height);
    ctx.setLineDash([]);

    ctx.fillStyle = `rgba(${ACCENT}, ${isActive ? 0.12 : 0.05})`;
    ctx.fillRect(screenRect.x, screenRect.y, screenRect.width, screenRect.height);

    // Label: reason + source time range. Clamped into the canvas so it stays
    // readable when the rect is mostly off-screen (deep zoom).
    const fontSize = Math.round(outputSize.height * 0.022);
    const pad = Math.round(fontSize * 0.4);
    const range = current.sourceStartTimeMs === current.sourceEndTimeMs
        ? `${current.sourceStartTimeMs.toFixed(0)}ms`
        : `${current.sourceStartTimeMs.toFixed(0)}–${current.sourceEndTimeMs.toFixed(0)}ms`;
    const text = `${current.reason} · ${range}${isActive ? '' : ' (held)'}`;

    ctx.font = `bold ${fontSize}px sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    const boxWidth = ctx.measureText(text).width + pad * 2;
    const boxHeight = fontSize + pad * 2;

    // Prefer just above the rect; fall back to inside its top edge when there is
    // no room above.
    const preferredY = screenRect.y - boxHeight - pad;
    const boxX = clamp(screenRect.x, 0, Math.max(0, outputSize.width - boxWidth));
    const boxY = clamp(
        preferredY >= 0 ? preferredY : screenRect.y + pad,
        0,
        Math.max(0, outputSize.height - boxHeight)
    );

    ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
    ctx.fillRect(boxX, boxY, boxWidth, boxHeight);
    ctx.fillStyle = `rgba(${ACCENT}, 1)`;
    ctx.fillText(text, boxX + pad, boxY + pad);

    ctx.restore();
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}
