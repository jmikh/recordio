import { type UserEvent, type UserEvents, type ViewportMotion, type Size, type Rect } from '../types';
import { ViewMapper } from './viewMapper';

export * from './viewMapper';

// ============================================================================
// Core Abstractions
// ============================================================================

// Time at the beginning and the end of the video where we won't apply zoom
const NoZoomBufferMs = 1000;

/**
 * Analyzes a stream of UserEvents to detect periods where the mouse remains
 * relatively stationary (within a bounding box) for a minimum duration.
 * Returns these periods as synthetic 'HoverEvents'.
 */
function findHoverEvents(
    events: UserEvents,
    inputSize: Size
): UserEvent[] {
    const hoverBoxSize = Math.max(inputSize.width, inputSize.height) * 0.1;
    const hoverMinDurationMs = 1000;

    const hoverEvents: UserEvent[] = [];

    const boundaries: number[] = [
        ...(events.mouseClicks || []).map(e => e.timestamp),
        ...(events.scrolls || []).map(e => e.timestamp)
    ].sort((a, b) => a - b);

    let i = 0;
    let boundaryIdx = 0;

    while (i < events.mousePositions.length) {
        // Fast-forward disruption index to be relevant for current start time
        while (
            boundaryIdx < boundaries.length &&
            boundaries[boundaryIdx] <= events.mousePositions[i].timestamp
        ) {
            boundaryIdx++;
        }

        // The next disruption that could interrupt a hover starting at segment[i]
        const nextBoundaryTime = (boundaryIdx < boundaries.length)
            ? boundaries[boundaryIdx]
            : Number.POSITIVE_INFINITY;

        if (events.mousePositions[i].timestamp + hoverMinDurationMs >= nextBoundaryTime) {
            i++;
            continue;
        }

        let j = i;
        let minX = events.mousePositions[i].x;
        let maxX = events.mousePositions[i].x;
        let minY = events.mousePositions[i].y;
        let maxY = events.mousePositions[i].y;

        while (j < events.mousePositions.length) {
            const p = events.mousePositions[j]; // p is MouseEvent
            if (p.timestamp >= nextBoundaryTime) {
                break;
            }

            const newMinX = Math.min(minX, p.x);
            const newMaxX = Math.max(maxX, p.x);
            const newMinY = Math.min(minY, p.y);
            const newMaxY = Math.max(maxY, p.y);

            if ((newMaxX - newMinX) <= hoverBoxSize && (newMaxY - newMinY) <= hoverBoxSize) {
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
            const startEvent = events.mousePositions[i];
            const endEvent = events.mousePositions[j - 1];
            const duration = endEvent.timestamp - startEvent.timestamp;

            if (duration >= hoverMinDurationMs) {
                const points = events.mousePositions.slice(i, j);
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

    return hoverEvents;
}

// Re-export time mapper for convenience if needed, or import directly
import { mapSourceToOutputTime, mapOutputToSourceTime } from './timeMapper';
import type { OutputWindow } from '../types';


// Helper: Recalculate Output Time Events
const recalculateOutputTimeEvents = (
    sourceEvents: UserEvents | null,
    outputWindows: OutputWindow[],
    timelineOffsetMs: number
): UserEvents | null => {
    if (!sourceEvents) return null;
    const mapFn = (events: any[]) => {
        return (events || [])
            .map(e => {
                const mappedTime = mapSourceToOutputTime(e.timestamp, outputWindows, timelineOffsetMs);
                if (mappedTime === -1) return null;
                if (mappedTime < NoZoomBufferMs) return null;
                return { ...e, timestamp: mappedTime };
            })
            .filter(e => e !== null);
    };

    return {
        mouseClicks: mapFn(sourceEvents.mouseClicks),
        mousePositions: mapFn(sourceEvents.mousePositions),
        keyboardEvents: mapFn(sourceEvents.keyboardEvents),
        drags: mapFn(sourceEvents.drags),
        scrolls: mapFn(sourceEvents.scrolls),
    };
};

export function calculateZoomSchedule(
    maxZoom: number,
    viewMapper: ViewMapper,
    events: UserEvents,
    outputWindows: OutputWindow[],
    timelineOffsetMs: number
): ViewportMotion[] {
    console.log('[ZoomDebug] calculateZoomSchedule');
    const motions: ViewportMotion[] = [];

    // 1. Map all events to Output Time
    const outputTimeEvents = recalculateOutputTimeEvents(events, outputWindows, timelineOffsetMs);
    if (!outputTimeEvents) return [];

    // 2. Find Hovers (using Output Time events)
    // Coordinates are still in Input Space, so we pass inputVideoSize for box sizing.
    const outputHovers = findHoverEvents(outputTimeEvents, viewMapper.inputVideoSize);

    // 3. Merge Clicks and Hovers
    const relevantEvents = [
        ...(outputTimeEvents.mouseClicks || []),
        ...outputHovers
    ].sort((a: any, b: any) => a.timestamp - b.timestamp);


    const zoomLevel = maxZoom;
    const targetWidth = viewMapper.outputVideoSize.width / zoomLevel;
    const targetHeight = viewMapper.outputVideoSize.height / zoomLevel;

    const ZOOM_TRANSITION_DURATION = 750;

    for (let i = 0; i < relevantEvents.length; i++) {
        const evt = relevantEvents[i] as any; // Cast to access x/y safely
        let arrivalTime = evt.timestamp; // Already Output Time

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
        const lastMotionOutputTime = motionOutputTimes.length > 0 ? motionOutputTimes[motionOutputTimes.length - 1] : 0;
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
            // Note: We use Output Time for conflict detection to ensure visual smoothness
            const availableTime = arrivalTime - lastMotionOutputTime;
            if (availableTime < ZOOM_TRANSITION_DURATION) {
                // Shorten duration to avoid overlap
                duration = Math.max(0, availableTime);
            }
        }

        const sourceEndTime = mapOutputToSourceTime(arrivalTime, outputWindows, timelineOffsetMs);
        if (sourceEndTime !== -1) {
            motions.push({
                sourceEndTimeMs: sourceEndTime,
                durationMs: duration,
                rect: newViewport
            });
            motionOutputTimes.push(arrivalTime);
        }
    }

    return motions;
}
// Local scope tracking for duration calc
const motionOutputTimes: number[] = [];

// ============================================================================
// Runtime Execution / Interpolation (Output Space)
// ============================================================================


export function getViewportStateAtTime(
    motions: ViewportMotion[],
    outputTimeMs: number,
    outputSize: Size,
    outputWindows: OutputWindow[],
    timelineOffsetMs: number
): Rect {
    const fullRect: Rect = { x: 0, y: 0, width: outputSize.width, height: outputSize.height };

    let currentRect = fullRect;

    // TODO: handle zoom overlaps here when allow users to add zooms they might overlap and we don't want to jump. easy way if multiple zooms overlap select the later one.
    for (const motion of motions) {
        const motionOutputTime = mapSourceToOutputTime(motion.sourceEndTimeMs, outputWindows, timelineOffsetMs);

        if (motionOutputTime == -1) {
            // Motion End is invisible, don't zoom.
            continue;
        }
        const startTime = motionOutputTime - motion.durationMs;

        if (outputTimeMs >= startTime && outputTimeMs <= motionOutputTime) {
            // Inside transition (Smooth interpolation in Output Time)
            const progress = (outputTimeMs - startTime) / motion.durationMs;
            const eased = applyEasing(progress);
            currentRect = interpolateRect(currentRect, motion.rect, eased);
            break; // Found the active transition
        } else if (outputTimeMs < startTime) {
            // Not reached this transition yet
            // Since we are processing in order, we stop and return the current state (which is the previous motion end or full rect)
            break;
        }
        // Else: We passed this transition. Update currentRect to this motion's end state and continue.
        currentRect = motion.rect;

    }

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
