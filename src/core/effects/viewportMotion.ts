import { type UserEvent, type UserEvents, type ViewportMotion, type Size, type Rect, EventType } from '../types';
import { ViewMapper } from './viewMapper';

export * from './viewMapper';

// ============================================================================
// Core Abstractions
// ============================================================================

const HoverMinDurationMs = 1000;

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

        if (events.mousePositions[i].timestamp + HoverMinDurationMs >= nextBoundaryTime) {
            i++;
            continue;
        }

        let j = i;
        let minX = events.mousePositions[i].mousePos.x;
        let maxX = events.mousePositions[i].mousePos.x;
        let minY = events.mousePositions[i].mousePos.y;
        let maxY = events.mousePositions[i].mousePos.y;

        while (j < events.mousePositions.length) {
            const p = events.mousePositions[j]; // p is MouseEvent
            if (p.timestamp >= nextBoundaryTime) {
                break;
            }

            const newMinX = Math.min(minX, p.mousePos.x);
            const newMaxX = Math.max(maxX, p.mousePos.x);
            const newMinY = Math.min(minY, p.mousePos.y);
            const newMaxY = Math.max(maxY, p.mousePos.y);


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

            if (duration >= HoverMinDurationMs) {
                const points = events.mousePositions.slice(i, j);
                const centerX = points.reduce((sum, p) => sum + p.mousePos.x, 0) / points.length;
                const centerY = points.reduce((sum, p) => sum + p.mousePos.y, 0) / points.length;

                hoverEvents.push({
                    type: 'hover',
                    timestamp: startEvent.timestamp, // Source Time
                    mousePos: { x: centerX, y: centerY },
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

    // 2. Find Hovers 
    const outputHovers = findHoverEvents(outputTimeEvents, viewMapper.inputVideoSize);

    // 3. Merge Clicks, Hovers, and Scrolls
    const relevantEvents = [
        ...(outputTimeEvents.mouseClicks || []),
        ...(outputTimeEvents.scrolls || []),
        ...outputHovers
    ].sort((a: any, b: any) => a.timestamp - b.timestamp);


    const minViewportWidth = viewMapper.outputVideoSize.width / maxZoom;
    const ZOOM_TRANSITION_DURATION = 750;

    // Track local scope for duration smoothing
    const motionOutputTimes: number[] = [];

    let noZoomInUntilMs = 1000;
    let lastViewport: Rect = { x: 0, y: 0, width: viewMapper.outputVideoSize.width, height: viewMapper.outputVideoSize.height };

    for (let i = 0; i < relevantEvents.length; i++) {
        const evt = relevantEvents[i] as any;
        if (evt.type == EventType.SCROLL) {
            noZoomInUntilMs = evt.timestamp + 2000;
        }
        let arrivalTime = evt.timestamp;

        // Calculate Target Viewport State
        const newViewport = createTargetViewport(evt, viewMapper, minViewportWidth);

        let duration = ZOOM_TRANSITION_DURATION;


        if (lastViewport.width > newViewport.width && arrivalTime < noZoomInUntilMs && isPointInRect(evt.mousePos, lastViewport)) {
            if (evt.type === EventType.HOVER) {
                if (noZoomInUntilMs - HoverMinDurationMs < evt.endTime) {
                    // We can delay the zoom to hover
                    arrivalTime = noZoomInUntilMs;
                } else {
                    continue; // Skip this motion
                }
            } else {
                continue; // Skip this motion (click/scroll too fast?)
            }
        } else if (lastViewport.width === newViewport.width) {
            // if last viewport is of the same size, skip the motion if delta x,y diagonal between the two viewports are smaller than 20% of the viewport bigger side.
            const dx = newViewport.x - lastViewport.x;
            const dy = newViewport.y - lastViewport.y;
            const diagonalDistance = Math.sqrt(dx * dx + dy * dy);

            const maxSide = Math.max(lastViewport.width, lastViewport.height);
            const threshold = maxSide * 0.2;

            if (diagonalDistance < threshold) {
                continue;
            }
        }

        const sourceEndTime = mapOutputToSourceTime(arrivalTime, outputWindows, timelineOffsetMs);
        if (sourceEndTime == -1) {
            console.error("converting to invalid source time in zoom calculatinos");
        } else {
            lastViewport = newViewport;
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

function createTargetViewport(evt: any, viewMapper: ViewMapper, minViewportWidth: number): Rect {
    let unconstrainedViewport: Rect;

    if (evt.type === 'scroll') {
        unconstrainedViewport = createScrollViewport(evt, viewMapper, minViewportWidth);
    } else {
        unconstrainedViewport = createStandardViewport(evt, viewMapper, minViewportWidth);
    }

    return clampViewport(unconstrainedViewport, viewMapper.outputVideoSize);
}

function createScrollViewport(evt: any, viewMapper: ViewMapper, minViewportWidth: number): Rect {
    const outputSize = viewMapper.outputVideoSize;
    // --- SCROLL ZOOM LOGIC ---
    // 1. Calculate Target Width from Bounding Box (in Output Space)
    const p1 = viewMapper.inputToOutput({ x: 0, y: 0 });
    const p2 = viewMapper.inputToOutput({ x: evt.boundingBox.width, y: 0 });
    const boxWidthOutput = Math.abs(p2.x - p1.x); // Assumes linear scaling

    let targetWidth = boxWidthOutput;

    if (targetWidth > outputSize.width) targetWidth = outputSize.width;
    if (targetWidth < minViewportWidth) targetWidth = minViewportWidth;

    // Aspect Ratio is fixed to Output Video
    const aspectRatio = outputSize.width / outputSize.height;
    const targetHeight = targetWidth / aspectRatio;

    // 2. Calculate Center (Horizontal: Box Center, Vertical: Mouse Position)
    const inputBoxCenterX = evt.boundingBox.x + evt.boundingBox.width / 2;
    const inputMouseY = evt.mousePos.y;

    const centerOutput = viewMapper.inputToOutput({ x: inputBoxCenterX, y: inputMouseY });
    const centerX = centerOutput.x;
    const centerY = centerOutput.y;

    return {
        x: centerX - targetWidth / 2,
        y: centerY - targetHeight / 2,
        width: targetWidth,
        height: targetHeight
    };
}

function createStandardViewport(evt: any, viewMapper: ViewMapper, minViewportWidth: number): Rect {
    // --- STANDARD ZOOM LOGIC (Click/Hover) ---
    const outputSize = viewMapper.outputVideoSize;
    const targetWidth = minViewportWidth;
    // Maintain Aspect Ratio
    const aspectRatio = outputSize.width / outputSize.height;
    const targetHeight = targetWidth / aspectRatio;

    const centerOutput = viewMapper.inputToOutput({ x: evt.mousePos.x, y: evt.mousePos.y });
    const centerX = centerOutput.x;
    const centerY = centerOutput.y;

    return {
        x: centerX - targetWidth / 2,
        y: centerY - targetHeight / 2,
        width: targetWidth,
        height: targetHeight
    };
}

function clampViewport(viewport: Rect, outputSize: Size): Rect {
    let { x, y, width, height } = viewport;

    const maxX = outputSize.width - width;
    if (x < 0) x = 0;
    else if (x > maxX) x = maxX;

    const maxY = outputSize.height - height;
    if (y < 0) y = 0;
    else if (y > maxY) y = maxY;

    return { x, y, width, height };
}


// ============================================================================
// Runtime Execution / Interpolation (Output Space)
// ============================================================================


/**
 * Calculates the exact state (x, y, width, height) of the viewport at a given output time.
 * 
 * It replays the sequence of viewport motions up to the requested time, 
 * handling interpolation between states.
 * 
 * **Intersection Behavior:**
 * If a new motion starts before the previous motion has completed (an intersection),
 * the previous motion is "interrupted" at the exact start time of the incoming motion. 
 * The calculated viewport state at that moment of interruption becomes the starting 
 * state for the new motion. This ensures continuous, smooth transitions even when 
 * events occur rapidly and overlap.
 */
export function getViewportStateAtTime(
    motions: ViewportMotion[],
    outputTimeMs: number,
    outputSize: Size,
    outputWindows: OutputWindow[],
    timelineOffsetMs: number
): Rect {
    const fullRect: Rect = { x: 0, y: 0, width: outputSize.width, height: outputSize.height };

    // 1. Prepare valid motions with computed start/end times in Output Space
    const validMotions = motions
        .map(m => {
            const end = mapSourceToOutputTime(m.sourceEndTimeMs, outputWindows, timelineOffsetMs);
            if (end === -1) return null;
            return {
                ...m,
                endTime: end,
                startTime: end - m.durationMs
            };
        })
        .filter((m): m is NonNullable<typeof m> => m !== null)
        .sort((a, b) => a.startTime - b.startTime); // Ensure chronological order

    let currentRect = fullRect;

    for (let i = 0; i < validMotions.length; i++) {
        const motion = validMotions[i];
        const nextMotion = validMotions[i + 1];

        // The time until which this motion is the "active" governing motion
        // It rules until it finishes OR until the next motion starts (interruption)
        const interruptionTime = nextMotion ? nextMotion.startTime : Number.POSITIVE_INFINITY;

        // If the current output time is BEFORE this motion even starts, 
        // implies we are in a gap before this motion. 
        // We should just return the currentRect (result of previous chain).
        if (outputTimeMs < motion.startTime) {
            return currentRect;
        }

        // We are currently INSIDE or AFTER this motion's start.

        // Define the target time we want to simulate to in this step.
        // It is either the current lookup time (if we found our frame), 
        // or the interruption time (start of next motion).
        const timeLimit = Math.min(outputTimeMs, interruptionTime);

        // Calculate progress relative to the motion's FULL duration (to preserve speed/easing curve)
        const elapsed = timeLimit - motion.startTime;
        const progress = Math.max(0, Math.min(1, elapsed / motion.durationMs));
        const eased = applyEasing(progress);

        const interpolated = interpolateRect(currentRect, motion.rect, eased);

        // If our lookup time was within this segment, we are done!
        if (outputTimeMs <= interruptionTime) {
            return interpolated;
        }

        // Otherwise, we have passed this segment (motion finished or interrupted).
        // The 'interpolated' rect becomes the starting point for the next motion.
        currentRect = interpolated;
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



function isPointInRect(point: { x: number, y: number }, rect: Rect): boolean {
    return point.x >= rect.x && point.x <= rect.x + rect.width &&
        point.y >= rect.y && point.y <= rect.y + rect.height;
}
