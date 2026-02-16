import type { BaseEvent, Rect } from '../../types';
import type { MouseClickSettings } from '../../types/settings';
import type { ViewMapper } from '../mappers/viewMapper';
import type { TimeMapper } from '../mappers/timeMapper';

const CLICK_DURATION = 500;
export const MOUSE_BASE_RADIUS = 80;

/**
 * Converts a hex color string to an RGBA tuple.
 * Supports 6-digit (#rrggbb) and 8-digit (#rrggbbaa) hex.
 */
export function hexToRgba(hex: string): [number, number, number, number] {
    const cleaned = hex.replace('#', '');
    const r = parseInt(cleaned.substring(0, 2), 16);
    const g = parseInt(cleaned.substring(2, 4), 16);
    const b = parseInt(cleaned.substring(4, 6), 16);
    const a = cleaned.length >= 8 ? parseInt(cleaned.substring(6, 8), 16) / 255 : 1;
    return [r, g, b, a];
}

// ── Ring Effect ──────────────────────────────────────────────
// Expanding stroke-only circle that grows outward and fades.

function paintRing(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    progress: number,
    settings: MouseClickSettings
) {
    const [r, g, b, a] = hexToRgba(settings.color);
    const maxRadius = MOUSE_BASE_RADIUS * settings.size;
    const currentRadius = maxRadius * progress;
    const opacity = 0.7 * a * (1 - progress);
    const lineWidth = 3 * (1 - progress * 0.5);

    ctx.beginPath();
    ctx.arc(x, y, currentRadius, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${opacity})`;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
}

// ── Circle Effect ────────────────────────────────────────────
// Filled circle that expands while fading.

function paintCircle(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    progress: number,
    settings: MouseClickSettings
) {
    const [r, g, b, a] = hexToRgba(settings.color);
    const currentRadius = MOUSE_BASE_RADIUS * settings.size * progress;
    const opacity = 0.5 * a * (1 - progress);

    ctx.beginPath();
    ctx.arc(x, y, currentRadius, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${opacity})`;
    ctx.fill();
}

// ── Painter Dispatch ─────────────────────────────────────────

const EFFECT_RENDERERS: Record<
    MouseClickSettings['effectType'],
    (ctx: CanvasRenderingContext2D, x: number, y: number, progress: number, settings: MouseClickSettings) => void
> = {
    ring: paintRing,
    circle: paintCircle,
};

/**
 * Draws click effects on the canvas.
 * Event timestamps are source time; they are mapped to output time via timeMapper.
 * Events in cut/hidden segments (mapped to -1) are skipped.
 */
export function paintMouseClicks(
    ctx: CanvasRenderingContext2D,
    events: BaseEvent[],
    currentOutputTime: number,
    viewport: Rect,
    viewMapper: ViewMapper,
    settings: MouseClickSettings,
    timeMapper: TimeMapper
) {
    const renderer = EFFECT_RENDERERS[settings.effectType];

    for (const click of events) {
        const mappedTime = timeMapper.mapSourceToOutputTime(click.timestamp);
        if (mappedTime < 0) continue; // Event is in a cut/hidden segment

        if (currentOutputTime >= mappedTime && currentOutputTime <= mappedTime + CLICK_DURATION) {
            const elapsed = currentOutputTime - mappedTime;
            const progress = elapsed / CLICK_DURATION;

            const center = viewMapper.projectToScreen(click.mousePos, viewport);
            renderer(ctx, center.x, center.y, progress, settings);
        }
    }
}

