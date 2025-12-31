import { type UserEvents, type ViewportMotion, type Size, type Rect, EventType } from './types';
import { ViewMapper } from './viewMapper';
import { TimeMapper } from './timeMapper';

export * from './viewMapper';

// ============================================================================
// Core Abstractions
// ============================================================================


const HoverMinDurationMs = 1000;


// Helper: Recalculate Output Time Events
const recalculateOutputTimeEvents = (
    sourceEvents: UserEvents | null,
    timeMapper: TimeMapper
): UserEvents | null => {
    if (!sourceEvents) return null;
    const mapFn = (events: any[]) => {
        return (events || [])
            .map(e => {
                const mappedTime = timeMapper.mapSourceToOutputTime(e.timestamp);
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
        typingEvents: (sourceEvents.typingEvents || []).map(e => {
            const mappedRange = timeMapper.mapSourceRangeToOutputRange(e.timestamp, e.endTime);
            if (!mappedRange) return null;

            return { ...e, timestamp: mappedRange.start, endTime: mappedRange.end };
        }).filter(e => e !== null) as any[],
        urlChanges: mapFn(sourceEvents.urlChanges),
    };
};

export function calculateZoomSchedule(
    maxZoom: number,
    viewMapper: ViewMapper,
    events: UserEvents,
    timeMapper: TimeMapper
): ViewportMotion[] {
    console.log('[ZoomDebug] calculateZoomSchedule2');

    // 1. Map all events to Output Time
    const outputTimeEvents = recalculateOutputTimeEvents(events, timeMapper);
    if (!outputTimeEvents) return [];

    // 2. Prepare Explicit Events
    const explicitEvents = [
        ...(outputTimeEvents.mouseClicks || []),
        ...(outputTimeEvents.scrolls || []),
        ...(outputTimeEvents.typingEvents || []),
        ...(outputTimeEvents.urlChanges || [])
    ].sort((a: any, b: any) => a.timestamp - b.timestamp);

    const mousePositions = outputTimeEvents.mousePositions || [];
    let mousePosIdx = 0;
    let explicitIdx = 0;

    const hoverBoxSize = Math.max(viewMapper.inputVideoSize.width, viewMapper.inputVideoSize.height) * 0.1;

    const findNextHover = (timeLimit: number) => {
        let searchIdx = mousePosIdx;

        while (searchIdx < mousePositions.length) {
            if (mousePositions[searchIdx].timestamp >= timeLimit) {
                break;
            }

            let i = searchIdx;
            // Start Hover Check at i
            let j = i;
            let minX = mousePositions[i].mousePos.x;
            let maxX = mousePositions[i].mousePos.x;
            let minY = mousePositions[i].mousePos.y;
            let maxY = mousePositions[i].mousePos.y;

            let validHoverEndIdx = -1;

            while (j < mousePositions.length) {
                const p = mousePositions[j];
                // If we cross the time limit, we stop scanning for this specific hover sequence
                if (p.timestamp >= timeLimit) break;

                const newMinX = Math.min(minX, p.mousePos.x);
                const newMaxX = Math.max(maxX, p.mousePos.x);
                const newMinY = Math.min(minY, p.mousePos.y);
                const newMaxY = Math.max(maxY, p.mousePos.y);

                if ((newMaxX - newMinX) <= hoverBoxSize && (newMaxY - newMinY) <= hoverBoxSize) {
                    // Still within box
                    const d = p.timestamp - mousePositions[i].timestamp;
                    if (d >= HoverMinDurationMs) {
                        validHoverEndIdx = j;
                    }

                    minX = newMinX;
                    maxX = newMaxX;
                    minY = newMinY;
                    maxY = newMaxY;
                    j++;
                } else {
                    break; // Broken box
                }
            }

            if (validHoverEndIdx !== -1) {
                // We found a hover!
                const startP = mousePositions[i];
                const endP = mousePositions[validHoverEndIdx];

                // Calculate center
                const points = mousePositions.slice(i, validHoverEndIdx + 1);
                const centerX = points.reduce((sum, p) => sum + p.mousePos.x, 0) / points.length;
                const centerY = points.reduce((sum, p) => sum + p.mousePos.y, 0) / points.length;

                // Capture variable 
                mousePosIdx = validHoverEndIdx + 1;

                return {
                    type: EventType.HOVER,
                    timestamp: startP.timestamp,
                    endTime: endP.timestamp,
                    mousePos: { x: centerX, y: centerY }
                };
            }

            searchIdx++;
        }
        return null;
    };

    const isRectContained = (inner: Rect, outer: Rect): boolean => {
        return inner.x >= outer.x &&
            inner.y >= outer.y &&
            (inner.x + inner.width) <= (outer.x + outer.width) &&
            (inner.y + inner.height) <= (outer.y + outer.height);
    };

    const motions: ViewportMotion[] = [];
    const outputVideoSize = viewMapper.outputVideoSize;
    let lastViewport: Rect = { x: 0, y: 0, width: outputVideoSize.width, height: outputVideoSize.height };

    const processEvent = (evt: any, isHover: boolean) => {
        const mustSeeRect = getMustSeeRect(evt, maxZoom, viewMapper);
        const targetViewport = getViewport(mustSeeRect, maxZoom, viewMapper);

        const mustSeeFits = isRectContained(mustSeeRect, lastViewport);

        // Use a small epsilon for float comparison safety
        const sizeChanged = Math.abs(targetViewport.width - lastViewport.width) > 0.1;

        let shouldGenerateMotion = false;

        if (isHover) {
            // "if current event is a hover only add a viewportMotion if mustseearea doesn't fit entirely in lastviewport"
            if (!mustSeeFits) {
                shouldGenerateMotion = true;
            }
        } else if (!mustSeeFits || sizeChanged) {
            // "if mustsee rect doesnt fit entirely in lastviewport or new viewport is not same size as last viewport , then add a viewportMotion"
            shouldGenerateMotion = true;
        }

        if (shouldGenerateMotion) {
            const sourceEndTime = timeMapper.mapOutputToSourceTime(evt.timestamp);
            if (sourceEndTime !== -1) {
                motions.push({
                    id: crypto.randomUUID(),
                    sourceEndTimeMs: sourceEndTime,
                    durationMs: 500, // Hardcoded transition duration for now?
                    rect: targetViewport,
                    reason: evt.type
                });
                lastViewport = targetViewport;
            }
        }
    };


    const ZOOM_TRANSITION_DURATION = 500;
    const IGNORE_EVENTS_BUFFER = 3000;
    const totalOutputDuration = timeMapper.getOutputDuration();
    const zoomOutStartTime = Math.max(0, totalOutputDuration - IGNORE_EVENTS_BUFFER);


    while (explicitIdx < explicitEvents.length || mousePosIdx < mousePositions.length) {
        // Determine the time limit for the next potential hover scan
        const nextExplicit = explicitIdx < explicitEvents.length ? explicitEvents[explicitIdx] : null;

        // CHECK IGNORE BUFFER
        if (nextExplicit && nextExplicit.timestamp >= zoomOutStartTime) {
            // Next explicit event is in the ignore zone. We effectively stop processing explicit events.
            // We also shouldn't scan for hovers past this point.
            break;
        }

        // If we have an explicit event coming up, we only scan for hovers up to that point.
        // If we run out of explicit events, we scan until the end of mouse positions.
        let hoverTimeLimit = nextExplicit ? nextExplicit.timestamp : Number.POSITIVE_INFINITY;

        // Clamp timeLimit to zoomOutStartTime
        if (hoverTimeLimit > zoomOutStartTime) {
            hoverTimeLimit = zoomOutStartTime;
        }

        // --- SCAN FOR HOVER ---
        // We look for a hover starting at mousePosIdx that FINISHES before timeLimit.

        let foundHover: any = null;

        if (mousePosIdx < mousePositions.length) {
            foundHover = findNextHover(hoverTimeLimit);
        }

        if (foundHover) {
            processEvent(foundHover, true);
            continue;
        }

        // --- NO HOVER FOUND ---
        if (nextExplicit) {
            processEvent(nextExplicit, false);
            explicitIdx++;

            // Advance mousePosIdx to be at least past this event to avoid scanning ancient history
            let advanceUntil = nextExplicit.timestamp;
            if (nextExplicit.type === EventType.TYPING && (nextExplicit as any).endTime) {
                advanceUntil = (nextExplicit as any).endTime;
            }

            while (mousePosIdx < mousePositions.length && mousePositions[mousePosIdx].timestamp <= advanceUntil) {
                mousePosIdx++;
            }
        } else {
            // No hover found, and no explicit event left (or we hit time limit/zoomOutStart). We are done.
            break;
        }
    }

    // --- APPEND FINAL ZOOM OUT ---
    // "only if last viewportMotion is a not a full zoomout already"
    const isFullZoom = Math.abs(lastViewport.width - outputVideoSize.width) < 1;

    if (!isFullZoom) {
        // Add zoom out to full view
        // Start: zoomOutStartTime
        // Duration: ZOOM_TRANSITION_DURATION
        // End (Output Time): zoomOutStartTime + ZOOM_TRANSITION_DURATION
        const zoomOutEndTime = zoomOutStartTime + ZOOM_TRANSITION_DURATION;
        const sourceEndTime = timeMapper.mapOutputToSourceTime(zoomOutEndTime);

        if (sourceEndTime !== -1) {
            motions.push({
                id: crypto.randomUUID(),
                sourceEndTimeMs: sourceEndTime,
                durationMs: ZOOM_TRANSITION_DURATION,
                rect: { x: 0, y: 0, width: outputVideoSize.width, height: outputVideoSize.height },
                reason: 'end_zoomout'
            });
        }
    }

    return motions;
}

export function getMustSeeRect(
    evt: any,
    maxZoom: number,
    viewMapper: ViewMapper
): Rect {
    const outputSize = viewMapper.outputVideoSize;
    const aspectRatio = outputSize.width / outputSize.height;

    // Default "Target" size (smaller than full zoom)
    const minWidth = outputSize.width / (maxZoom * 2);
    const minHeight = minWidth / aspectRatio;

    let targetWidth = minWidth;
    let targetHeight = minHeight;
    let centerX = 0;
    let centerY = 0;

    if (evt.type === EventType.TYPING || evt.type === EventType.SCROLL) {
        const targetRect = evt.targetRect || { x: 0, y: 0, width: outputSize.width, height: outputSize.height };
        const mappedTargetRect = viewMapper.inputToOutputRect(targetRect);

        // Calculate Target Dimensions
        // Add 10% padding to target rect
        targetWidth = Math.max(minWidth, mappedTargetRect.width * 1.1);
        // Clamp to output size if it overflows
        targetWidth = Math.min(outputSize.width, targetWidth);
        targetHeight = targetWidth / aspectRatio;

        // Determine Center
        // If the target area height fits in our calculated view height, center on the target area.
        if (mappedTargetRect.height <= targetHeight) {
            centerX = mappedTargetRect.x + mappedTargetRect.width / 2;
            centerY = mappedTargetRect.y + mappedTargetRect.height / 2;
        } else {
            // Target area is too tall (e.g. long text block or long scroll). Center horizontally, 
            // but vertically focus on the mouse cursor (where user is interacting)
            centerX = mappedTargetRect.x + mappedTargetRect.width / 2;
            const mouseOut = viewMapper.inputToOutputPoint(evt.mousePos);
            centerY = mouseOut.y;
        }

    } else if (evt.type === EventType.URLCHANGE) {
        // URL Change -> Full View
        targetWidth = outputSize.width;
        targetHeight = outputSize.height;
        centerX = targetWidth / 2;
        centerY = targetHeight / 2;

    } else {
        // Click / Hover / Scroll
        const mouseOut = viewMapper.inputToOutputPoint(evt.mousePos);
        centerX = mouseOut.x;
        centerY = mouseOut.y;
    }

    return clampViewport({
        x: centerX - targetWidth / 2,
        y: centerY - targetHeight / 2,
        width: targetWidth,
        height: targetHeight
    }, outputSize);
}

export function getViewport(
    mustSeeRect: Rect,
    maxZoom: number,
    viewMapper: ViewMapper
): Rect {
    const outputSize = viewMapper.outputVideoSize;
    const aspectRatio = outputSize.width / outputSize.height;

    // Minimum viewport size allowed by MAX ZOOM
    const minViewportWidth = outputSize.width / maxZoom;

    // The viewport must be at least as big as the mustSeeRect, 
    // but also at least as big as maxZoom allows.
    let viewportWidth = Math.max(minViewportWidth, mustSeeRect.width);

    // Maintain Aspect Ratio
    let viewportHeight = viewportWidth / aspectRatio;

    // Center around the Must See Rect
    const centerX = mustSeeRect.x + mustSeeRect.width / 2;
    const centerY = mustSeeRect.y + mustSeeRect.height / 2;

    const viewport = {
        x: centerX - viewportWidth / 2,
        y: centerY - viewportHeight / 2,
        width: viewportWidth,
        height: viewportHeight
    };

    return clampViewport(viewport, outputSize);
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
    timeMapper: TimeMapper
): Rect {
    const fullRect: Rect = { x: 0, y: 0, width: outputSize.width, height: outputSize.height };

    // 1. Prepare valid motions with computed start/end times in Output Space
    const validMotions = motions
        .map(m => {
            const end = timeMapper.mapSourceToOutputTime(m.sourceEndTimeMs);
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
