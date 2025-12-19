import type { UserEvent, MouseEffect, Point } from '../types';

// ============================================================================
// GENERATION LOGIC
// ============================================================================

const CLICK_DISPLAY_DURATION = 500; // ms

export function generateMouseEffects(
    events: UserEvent[],
    totalDurationMs: number = 0 // Used for unfinished drags
): MouseEffect[] {
    const effects: MouseEffect[] = [];
    if (!events || events.length === 0) return effects;

    // 1. Sort Events
    const sortedEvents = [...events].sort((a, b) => a.timestamp - b.timestamp);

    // 2. Single Pass Processing
    let activeDrag: Partial<MouseEffect> | null = null;

    for (const evt of sortedEvents) {
        if (evt.type === 'click') {
            effects.push({
                id: crypto.randomUUID(),
                type: 'click',
                timeInMs: evt.timestamp,
                timeOutMs: evt.timestamp + CLICK_DISPLAY_DURATION,
                start: { x: evt.x, y: evt.y }
            });
        }
        else if (evt.type === 'mousedown') {
            if (activeDrag) {
                continue;
            }
            // Start new drag
            activeDrag = {
                id: crypto.randomUUID(),
                type: 'drag',
                timeInMs: evt.timestamp,
                start: { x: evt.x, y: evt.y },
                path: [{ timestamp: evt.timestamp, x: evt.x, y: evt.y }]
            };
        }
        else if (evt.type === 'mouse') {
            // Mouse Move
            if (activeDrag && activeDrag.path) {
                activeDrag.path.push({ timestamp: evt.timestamp, x: evt.x, y: evt.y });
            }
        }
        else if (evt.type === 'mouseup') {
            // Drag End
            if (activeDrag) {
                activeDrag.timeOutMs = evt.timestamp;
                activeDrag.end = { x: evt.x, y: evt.y };
                if (activeDrag.path) {
                    activeDrag.path.push({ timestamp: evt.timestamp, x: evt.x, y: evt.y });
                }
                effects.push(activeDrag as MouseEffect);
                activeDrag = null;
            }
        }
    }

    // 3. Close open drag
    if (activeDrag) {
        activeDrag.timeOutMs = totalDurationMs;
        if (activeDrag.path && activeDrag.path.length > 0) {
            const last = activeDrag.path[activeDrag.path.length - 1];
            activeDrag.end = { x: last.x, y: last.y };
        } else {
            activeDrag.end = activeDrag.start;
        }
        effects.push(activeDrag as MouseEffect);
    }

    return effects;
}


// ============================================================================
// RENDERING HELPER
// ============================================================================


import type { Rect } from './cameraMotion';

/**
 * Maps a point in Source Coordinates to Destination (Canvas) Coordinates,
 * given the visible source rectangle (Camera) and the destination rectangle.
 */
export function projectSourceToCanvas(
    point: Point,
    sourceRect: Rect,
    destRect: Rect
): Point {
    // 1. Normalize Point in Source Rect (0 to 1)
    const normalizedX = (point.x - sourceRect.x) / sourceRect.width;
    const normalizedY = (point.y - sourceRect.y) / sourceRect.height;

    // 2. Map to Dest Rect
    return {
        x: destRect.x + normalizedX * destRect.width,
        y: destRect.y + normalizedY * destRect.height
    };
}


/**
 * Determines what to draw on the canvas for mouse effects at a specific time.
 * Returns a list of things to draw (since multiple effects could overlap theoretically? usually scalar).
 */
export function drawMouseEffects(
    ctx: CanvasRenderingContext2D,
    effects: MouseEffect[],
    timeMs: number,
    sourceRect: Rect, // Current Camera Frame
    destRect: Rect    // Current Canvas Draw Area
) {
    // Draw Clicks
    // Draw active Drags

    const activeEffects = effects.filter(e => timeMs >= e.timeInMs && timeMs <= e.timeOutMs);

    for (const effect of activeEffects) {
        if (effect.type === 'click') {
            const elapsed = timeMs - effect.timeInMs;
            const duration = effect.timeOutMs - effect.timeInMs;
            const progress = Math.min(1, Math.max(0, elapsed / duration));

            // Project Center
            const center = projectSourceToCanvas(effect.start, sourceRect, destRect);

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
                const currentPoint = getPointAtTime(effect.path, timeMs);

                // Project
                const screenPoint = projectSourceToCanvas(currentPoint, sourceRect, destRect);

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
