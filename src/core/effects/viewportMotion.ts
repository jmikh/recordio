import { type UserEvent, type ViewportMotion, type Size, type MouseEvent, type Rect, EventType } from '../types';
import { ViewMapper } from './viewMapper.ts';

export * from './viewMapper.ts';

// ============================================================================
// Core Abstractions
// ============================================================================

/**
 * Analyzes a stream of UserEvents to detect periods where the mouse remains
 * relatively stationary (within a bounding box) for a minimum duration.
 * Returns these periods as synthetic 'HoverEvents'.
 */
export function findHoverEvents(
    events: UserEvent[],
    inputSize: Size
): UserEvent[] {
    const boxSize = Math.max(inputSize.width, inputSize.height) * 0.1;
    const minDuration = 1000;

    const hoverEvents: UserEvent[] = [];
    let currentSegment: MouseEvent[] = [];

    const processSegment = (segment: MouseEvent[]) => {
        let i = 0;
        while (i < segment.length) {
            let j = i;
            let minX = segment[i].x;
            let maxX = segment[i].x;
            let minY = segment[i].y;
            let maxY = segment[i].y;

            while (j < segment.length) {
                const p = segment[j]; // p is MouseEvent
                const newMinX = Math.min(minX, p.x);
                const newMaxX = Math.max(maxX, p.x);
                const newMinY = Math.min(minY, p.y);
                const newMaxY = Math.max(maxY, p.y);

                if ((newMaxX - newMinX) <= boxSize && (newMaxY - newMinY) <= boxSize) {
                    minX = newMinX;
                    maxX = newMaxX;
                    minY = newMinY;
                    maxY = newMaxY;
                    j++;
                } else {
                    break;
                }
            }

            if (j > i) {
                const startEvent = segment[i];
                const endEvent = segment[j - 1];
                const duration = endEvent.timestamp - startEvent.timestamp;

                if (duration >= minDuration) {
                    const points = segment.slice(i, j);
                    const centerX = points.reduce((sum, p) => sum + p.x, 0) / points.length;
                    const centerY = points.reduce((sum, p) => sum + p.y, 0) / points.length;

                    hoverEvents.push({
                        type: 'hover',
                        timestamp: startEvent.timestamp, // Source Time
                        x: centerX,
                        y: centerY,
                        endTime: endEvent.timestamp
                    } as UserEvent);
                    i = j;
                } else {
                    i++;
                }
            } else {
                i++;
            }
        }
    };

    for (const evt of events) {
        if (evt.type === EventType.MOUSEPOS) {
            currentSegment.push(evt as MouseEvent);
        } else if ((evt as any).type === 'click' || (evt as any).type === 'url') {
            if (currentSegment.length > 0) {
                processSegment(currentSegment);
                currentSegment = [];
            }
        }
    }


    if (currentSegment.length > 0) {
        processSegment(currentSegment);
    }

    return hoverEvents;
}

// Re-export time mapper for convenience if needed, or import directly
import { mapSourceToOutputTime } from './timeMapper';
import type { OutputWindow } from '../types';

export function calculateZoomSchedule(
    maxZoom: number,
    viewMapper: ViewMapper,
    events: UserEvent[],
    outputWindows: OutputWindow[],
    timelineOffsetMs: number
): ViewportMotion[] {
    const motions: ViewportMotion[] = [];

    if (events.length === 0) return motions;

    // 1. Filter & Map ALL events to Output Time first
    // This ensures that hover detection and zoom scheduling happen on the "final cut"
    type MappedEvent = UserEvent & {
        originalTimestamp: number;
        // timestamp is already in UserEvent, but we are updating it.
    };

    // 1. Filter & Map ALL events to Output Time first
    // This ensures that hover detection and zoom scheduling happen on the "final cut"
    const mappedEvents: MappedEvent[] = [];

    console.log('[ZoomDebug] Raw events:', events.length);
    console.log('[ZoomDebug] Windows:', outputWindows);
    console.log('[ZoomDebug] Offset:', timelineOffsetMs);

    for (const evt of events) {
        const outputTime = mapSourceToOutputTime(evt.timestamp, outputWindows, timelineOffsetMs);
        if (outputTime !== -1 && outputTime > 2000) {
            // don't zoom until 2 seconds in
            // Clone and update timestamp to Output Time
            // We preserve originalTimestamp just in case, though not strictly needed for logic
            const mapped = { ...evt, timestamp: outputTime, originalTimestamp: evt.timestamp };
            mappedEvents.push(mapped);
        }
    }

    // Sort by Output Time
    mappedEvents.sort((a, b) => a.timestamp - b.timestamp);

    // 2. Detect Hovers in Output Space
    // Now that events are in continuous Output Time, findHoverEvents will correctly 
    // detect hovers even across cuts if the mouse position is stable.
    const hoverEvents = findHoverEvents(mappedEvents as UserEvent[], viewMapper.inputVideoSize);

    // 3. Merge Clicks and Hovers
    // Both are now already in Output Time.
    const relevantEvents = [
        ...mappedEvents.filter((e: any) => e.type === 'click'),
        ...hoverEvents
    ].sort((a: any, b: any) => a.timestamp - b.timestamp);

    console.log('[ZoomDebug] Relevant events (Output Time):', relevantEvents.length);

    const zoomLevel = maxZoom;
    const targetWidth = viewMapper.outputVideoSize.width / zoomLevel;
    const targetHeight = viewMapper.outputVideoSize.height / zoomLevel;

    const ZOOM_TRANSITION_DURATION = 500;

    for (let i = 0; i < relevantEvents.length; i++) {
        const evt = relevantEvents[i] as any; // Cast to access x/y safely
        const arrivalTime = evt.timestamp; // Already Output Time

        // Map Click to Output Space (Viewport)
        const centerOutput = viewMapper.inputToOutput({ x: evt.x, y: evt.y });

        // Center Viewport
        let viewportX = centerOutput.x - targetWidth / 2;
        let viewportY = centerOutput.y - targetHeight / 2;

        const maxX = viewMapper.outputVideoSize.width - targetWidth;
        const maxY = viewMapper.outputVideoSize.height - targetHeight;

        if (viewportX < 0) viewportX = 0;
        else if (viewportX > maxX) viewportX = maxX;

        if (viewportY < 0) viewportY = 0;
        else if (viewportY > maxY) viewportY = maxY;

        const newViewport: Rect = {
            x: viewportX,
            y: viewportY,
            width: targetWidth,
            height: targetHeight
        };

        const lastMotion = motions.length > 0 ? motions[motions.length - 1] : null;
        let duration = ZOOM_TRANSITION_DURATION;

        if (lastMotion) {
            // Optimization: If the new center is very close to the last center, don't move.
            // "Close enough" = within 25% of width in delta x and within 25% in height in delta y.
            const lastRect = lastMotion.rect;
            const lastCenterX = lastRect.x + lastRect.width / 2;
            const lastCenterY = lastRect.y + lastRect.height / 2;

            const dx = Math.abs(centerOutput.x - lastCenterX);
            const dy = Math.abs(centerOutput.y - lastCenterY);

            if (dx < lastRect.width * 0.25 && dy < lastRect.height * 0.25) {
                continue;
            }

            // Check if we have enough time for a full transition
            const availableTime = arrivalTime - lastMotion.endTimeMs;
            if (availableTime < ZOOM_TRANSITION_DURATION) {
                // Shorten duration to avoid overlap
                duration = Math.max(0, availableTime);
            }
        }

        motions.push({
            endTimeMs: arrivalTime,
            durationMs: duration,
            rect: newViewport
        });
    }

    return motions;
}

// ============================================================================
// Runtime Execution / Interpolation (Source Space)
// ============================================================================

export function getViewportStateAtTime(
    motions: ViewportMotion[],
    outputTimeMs: number,
    fullSize: Size
): Rect {
    const fullRect: Rect = { x: 0, y: 0, width: fullSize.width, height: fullSize.height };

    if (!motions || motions.length === 0) {
        return fullRect;
    }

    // Motions are stored by endTime. Sort just in case.
    const sortedMotions = [...motions].sort((a, b) => a.endTimeMs - b.endTimeMs);

    // 1. Find the active motion or the last completed motion
    // A motion defines the state at 'endTimeMs'.
    // Between (endTimeMs - duration) and endTimeMs, we interpolate.
    // Before that, we hold the previous motion's end state.

    let currentRect = fullRect;

    for (const motion of sortedMotions) {
        const startTime = motion.endTimeMs - motion.durationMs;

        if (outputTimeMs >= startTime && outputTimeMs <= motion.endTimeMs) {
            // Inside transition
            const progress = (outputTimeMs - startTime) / motion.durationMs;
            const eased = applyEasing(progress); // Assuming linear or simple ease
            return interpolateRect(currentRect, motion.rect, eased);
        } else if (outputTimeMs < startTime) {
            // Before this motion starts. 
            // We are holding 'currentRect' (result of previous iteration).
            return currentRect;
        }

        // We passed this motion. It strictly applied.
        // Update currentRect to be this motion's target.
        currentRect = motion.rect;
    }

    // If we passed all motions, we hold the last one
    return currentRect;
}

function applyEasing(t: number): number {
    return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; // Ease In Out
}

function interpolateRect(from: Rect, to: Rect, t: number): Rect {
    return {
        x: from.x + (to.x - from.x) * t,
        y: from.y + (to.y - from.y) * t,
        width: from.width + (to.width - from.width) * t,
        height: from.height + (to.height - from.height) * t,
    };
}
