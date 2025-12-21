import type { UserEvent, Clip, MouseUpEvent } from '../types.ts';

export interface MappedEvent {
    outputTime: number;
    originalEvent: UserEvent;
}

/**
 * Maps source events to timeline time based on a list of clips.
 * Assumes events and clips are sorted by their respective source times.
 * Injects synthetic 'mouseup' events if a drag is cut off by a clip boundary.
 */
export function mapEventsToTimeline(
    events: UserEvent[],
    clips: Clip[]
): MappedEvent[] {
    const mappedEvents: MappedEvent[] = [];

    // Optimization: Clips and Events are both sorted by increasing source time and strictly non-intersecting.
    // We can use a single pass (Two Pointers) O(N + M).
    let clipIndex = 0;

    // Track active drag state to inject missing mouseups
    // We store the last valid mapped mousedown event to know if we are "in a drag"
    // that needs closing when a clip ends.
    let pendingDragStart: UserEvent | null = null;

    for (const evt of events) {
        // Advance clips that end before this event
        // (If we were dragging, and we skip past a clip end, we might need to close it.
        // But since we process events in order, let's see if we pass a clip boundary.)

        while (clipIndex < clips.length && clips[clipIndex].sourceOutMs <= evt.timestamp) {
            // Clip Ended.
            // If we had a pending drag, we must close it at the end of this clip.
            if (pendingDragStart) {
                const endingClip = clips[clipIndex];
                // Inject MouseUp at the END of this clip's timeline
                // outputTime = timelineIn + duration
                // Using getTimelineOut logic:
                const duration = (endingClip.sourceOutMs - endingClip.sourceInMs) / endingClip.speed;
                const endTime = endingClip.timelineInMs + duration;

                const syntheticUp: MouseUpEvent = {
                    type: 'mouseup',
                    timestamp: endTime, // This timestamp is somewhat symbolic in MappedEvent
                    x: pendingDragStart.type === 'mousedown' ? pendingDragStart.x : 0,
                    y: pendingDragStart.type === 'mousedown' ? pendingDragStart.y : 0
                    // ideally last known position? We don't track position stream here easily.
                    // Reusing start position is a fallback, or we could interpolate if we had full history.
                    // For now, reuse start or just 0 if unknown. 
                    // Actually, if we just want to stop the drag effect, coords matter less than the event type.
                };

                mappedEvents.push({
                    outputTime: endTime,
                    originalEvent: syntheticUp
                });

                pendingDragStart = null;
            }
            clipIndex++;
        }

        // Check if we ran out of clips
        if (clipIndex >= clips.length) {
            break;
        }

        const clip = clips[clipIndex];

        // Check availability
        if (evt.timestamp >= clip.sourceInMs) {
            // Event is inside the current clip
            // (We already ensured timestamp < sourceOutMs via the loop above)

            const offset = evt.timestamp - clip.sourceInMs;
            const outputTime = clip.timelineInMs + (offset / clip.speed);

            mappedEvents.push({
                outputTime: outputTime,
                originalEvent: evt
            });

            // Update Drag State
            if (evt.type === 'mousedown') {
                pendingDragStart = evt;
            } else if (evt.type === 'mouseup') {
                pendingDragStart = null;
            }
        }
        // Else: evt.timestamp < clip.sourceInMs (Gap before next clip), ignore event.
    }

    // Edge Case: If we finish all events but still have a pending drag inside the LAST active clip?
    // The loop above only closes on clip change.
    // If the event stream ends, we might still be inside a clip.
    // But does the drag continue forever? 
    // If the clip ends at T=1000, and last event was T=500 mousedown.
    // We should probably close it at the end of that clip?
    // But we don't know if the user stopped dragging later (outside the event stream?).
    // Safest is to close it at clip end if we ran out of events.
    if (pendingDragStart && clipIndex < clips.length) {
        const endingClip = clips[clipIndex];
        const duration = (endingClip.sourceOutMs - endingClip.sourceInMs) / endingClip.speed;
        const endTime = endingClip.timelineInMs + duration;

        const syntheticUp: MouseUpEvent = {
            type: 'mouseup',
            timestamp: endTime,
            x: pendingDragStart.type === 'mousedown' ? pendingDragStart.x : 0,
            y: pendingDragStart.type === 'mousedown' ? pendingDragStart.y : 0
        };

        mappedEvents.push({
            outputTime: endTime,
            originalEvent: syntheticUp
        });
        pendingDragStart = null;
    }


    // Sort is theoretically redundant if both inputs are sorted and mapping preserves order.
    // But safety first for slight float jitters or speed < 0.
    mappedEvents.sort((a, b) => a.outputTime - b.outputTime);

    return mappedEvents;
}
