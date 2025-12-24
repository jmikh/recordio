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
import { mapSourceToOutputTime, mapOutputToSourceTime } from './timeMapper';
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

    // Filter & map ALL events to Output Time first to ensure that hover detection and zoom scheduling happen on the "final cut"
    const mappedEvents: UserEvent[] = [];

    console.log('[ZoomDebug] Raw events:', events.length);
    console.log('[ZoomDebug] Windows:', outputWindows);
    console.log('[ZoomDebug] Offset:', timelineOffsetMs);

    for (const evt of events) {
        const outputTime = mapSourceToOutputTime(evt.timestamp, outputWindows, timelineOffsetMs);
        if (outputTime !== -1 && outputTime > 1500) {
            // don't zoom until 1.5 seconds in
            const mapped = { ...evt, timestamp: outputTime };
            mappedEvents.push(mapped);
        }
    }

    // Detect Hovers in Output Space
    // Now that events are in continuous Output Time, findHoverEvents will correctly 
    // detect hovers even across cuts if the mouse position is stable.
    const hoverEvents = findHoverEvents(mappedEvents as UserEvent[], viewMapper.inputVideoSize);

    // Merge Clicks and Hovers
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
        let arrivalTime = evt.timestamp; // Already Output Time
        if (evt.type == EventType.CLICK) {
            // We want to arrive at click location before the zoom transition is over.
            arrivalTime -= 500;
        }

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

    if (!motions || motions.length === 0) {
        return fullRect;
    }

    let currentRect = fullRect;

    // TODO: handle zoom overlaps here when allow users to add zooms they might overlap and we don't want to jump. easy way if multiple zooms overlap select the later one.
    for (const motion of motions) {
        const motionOutputTime = mapSourceToOutputTime(motion.sourceEndTimeMs, outputWindows, timelineOffsetMs);

        if (motionOutputTime !== -1) {
            // Motion End is Visible
            const startTime = motionOutputTime - motion.durationMs;

            if (outputTimeMs >= startTime && outputTimeMs <= motionOutputTime) {
                // Inside transition (Smooth interpolation in Output Time)
                const progress = (outputTimeMs - startTime) / motion.durationMs;
                const eased = applyEasing(progress);
                return interpolateRect(currentRect, motion.rect, eased);
            } else if (outputTimeMs < startTime) {
                // Not reached this transition yet
                // Since we are processing in order, we stop and return the current state
                return currentRect;
            }
            // Else: We passed this transition. Update currentRect.
            currentRect = motion.rect;

        } else {
            continue;
        }
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
