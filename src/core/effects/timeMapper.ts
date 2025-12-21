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
        // Advance clips that end before this event to handle multi-clip timelines

        // Apply latency correction globally for logic consistency
        const correctedTimestamp = evt.timestamp + 100; // VIDEO_LATENCY_CORRECTION

        while (clipIndex < clips.length && clips[clipIndex].sourceOutMs <= correctedTimestamp) {
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
                    // Use start position as fallback since we don't track the full pointer path here
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
        if (correctedTimestamp >= clip.sourceInMs) {

            const offset = correctedTimestamp - clip.sourceInMs;
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

    // Edge Case: If the event stream ends while a drag is active, close it at the end of the current clip
    // to prevent infinite drags.
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


    // Ensure strict order in case of floating point precision issues
    mappedEvents.sort((a, b) => a.outputTime - b.outputTime);

    return mappedEvents;
}
