import type { UserEvent, MouseEffect, Clip } from '../types';
import { mapEventsToTimeline } from './timeMapper.ts';
// ============================================================================
// GENERATION LOGIC
// ============================================================================

const CLICK_DISPLAY_DURATION = 250; // ms

export function generateMouseEffects(
    events: UserEvent[],
    clips: Clip[]
): MouseEffect[] {
    const effects: MouseEffect[] = [];
    if (!events || events.length === 0) return effects;

    // 1. Filter & Map Events to Output Time
    const mappedEvents = mapEventsToTimeline(events, clips);

    // 2. Single Pass Processing on Mapped Events
    let activeDrag: Partial<MouseEffect> | null = null;

    for (const mapped of mappedEvents) {
        const evt = mapped.originalEvent;
        const time = mapped.outputTime;

        if (evt.type === 'click') {
            effects.push({
                id: crypto.randomUUID(),
                type: 'click',
                timeInMs: time,
                timeOutMs: time + CLICK_DISPLAY_DURATION,
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
                timeInMs: time,
                start: { x: evt.x, y: evt.y },
                path: [{ timestamp: time, x: evt.x, y: evt.y }]
            };
        }
        else if (evt.type === 'mouse') {
            // Mouse Move
            if (activeDrag && activeDrag.path) {
                activeDrag.path.push({ timestamp: time, x: evt.x, y: evt.y });
            }
        }
        else if (evt.type === 'mouseup') {
            // Drag End
            if (activeDrag) {
                activeDrag.timeOutMs = time;
                activeDrag.end = { x: evt.x, y: evt.y };
                if (activeDrag.path) {
                    activeDrag.path.push({ timestamp: time, x: evt.x, y: evt.y });
                }
                effects.push(activeDrag as MouseEffect);
                activeDrag = null;
            }
        }
    }

    // 3. Close open drag
    if (activeDrag) {
        // Use last event time or end of last clip?
        // If we ran out of events, just close it at the last known time.
        const lastTime = mappedEvents.length > 0 ? mappedEvents[mappedEvents.length - 1].outputTime : 0;
        activeDrag.timeOutMs = lastTime;
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


