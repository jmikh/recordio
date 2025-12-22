import type { UserEvent, ClickEvent, DragEvent } from '../types';

export function generateRecordingEvents(
    events: UserEvent[]
): { clickEvents: ClickEvent[], dragEvents: DragEvent[] } {
    const clickEvents: ClickEvent[] = [];
    const dragEvents: DragEvent[] = [];

    if (!events || events.length === 0) return { clickEvents, dragEvents };

    // 1. Clicks are direct pass-through (assuming source events are already cleaned/typed)
    // We explicitly cast or filter.
    clickEvents.push(...events.filter(e => e.type === 'click') as ClickEvent[]);

    // 2. Identify Drags (mousedown -> moves -> mouseup)
    let activeDrag: DragEvent | null = null;

    // Events are assumed to be sorted by timestamp
    // If not, we should sort them? Assuming sorted from source.

    for (const evt of events) {
        if (evt.type === 'mousedown') {
            if (activeDrag) {
                // Unexpected mousedown while dragging? Ignore or reset?
                continue;
            }
            activeDrag = {
                timestamp: evt.timestamp,
                type: 'drag',
                path: [{ timestamp: evt.timestamp, x: evt.x, y: evt.y }]
            };
        } else if (evt.type === 'mouse' && activeDrag) {
            // Mouse move during drag
            activeDrag.path.push({ timestamp: evt.timestamp, x: evt.x, y: evt.y });
        } else if (evt.type === 'mouseup' && activeDrag) {
            // End Drag
            activeDrag.path.push({ timestamp: evt.timestamp, x: evt.x, y: evt.y });
            dragEvents.push(activeDrag);
            activeDrag = null;
        }
    }

    // Close any trailing drag
    if (activeDrag) {
        // activeDrag.path is initialized on creation
        dragEvents.push(activeDrag);
    }

    return { clickEvents, dragEvents };
}


