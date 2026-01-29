import { type ViewportMotion, type Size, type Rect, type ZoomSettings, EventType } from './types';
import { ViewMapper } from './viewMapper';
import { type FocusArea } from './focusManager';

export * from './viewMapper';

// ============================================================================
// Core Abstractions
// ============================================================================

export function calculateZoomSchedule(
    zoomSettings: ZoomSettings,
    viewMapper: ViewMapper,
    focusAreas: FocusArea[],
    outputDuration: number
): ViewportMotion[] {
    const { maxZoom, maxZoomDurationMs, minZoomDurationMs } = zoomSettings;

    if (focusAreas.length === 0) return [];

    const isRectContained = (inner: Rect, outer: Rect): boolean => {
        return inner.x >= outer.x &&
            inner.y >= outer.y &&
            (inner.x + inner.width) <= (outer.x + outer.width) &&
            (inner.y + inner.height) <= (outer.y + outer.height);
    };

    const motions: ViewportMotion[] = [];
    const outputVideoSize = viewMapper.outputVideoSize;
    let lastViewport: Rect = { x: 0, y: 0, width: outputVideoSize.width, height: outputVideoSize.height };
    let lastMustSeeRect: Rect = lastViewport;

    const ZOOM_TRANSITION_DURATION = maxZoomDurationMs;
    const IGNORE_EVENTS_BUFFER = 3000;
    const zoomOutStartTime = Math.max(0, outputDuration - IGNORE_EVENTS_BUFFER);

    // 3. Process each focus area
    for (const area of focusAreas) {
        // Skip events in the ignore zone (last 3 seconds)
        if (area.timestamp >= zoomOutStartTime) {
            break;
        }

        // Use the focus area rect directly (already in source coordinates)
        // Map it to output coordinates for viewport calculation
        const mappedFocusRect = viewMapper.inputToOutputRect(area.rect);

        // The must-see rect is the focus area itself
        let mustSeeRect: Rect = mappedFocusRect;
        let targetViewport: Rect;

        // If the focus area spans the full source viewport, zoom fully out.
        // This is a cinematic decision: when the system indicates "full view",
        // we commit fully to showing everything rather than a partial zoom.
        const isFullViewport =
            Math.abs(area.rect.width - viewMapper.inputVideoSize.width) < 1 &&
            Math.abs(area.rect.height - viewMapper.inputVideoSize.height) < 1;

        if (isFullViewport) {
            mustSeeRect = { x: 0, y: 0, width: outputVideoSize.width, height: outputVideoSize.height };
            targetViewport = mustSeeRect;
        } else {
            // Calculate viewport: focus area centered within max zoom bounds
            targetViewport = getViewport(mustSeeRect, maxZoom, viewMapper);
        }

        const mustSeeFits = isRectContained(mustSeeRect, lastViewport);
        const sizeChanged = Math.abs(targetViewport.width - lastViewport.width) > 0.1;

        let shouldGenerateMotion = (!mustSeeFits || sizeChanged)

        if (shouldGenerateMotion) {
            const currentStartOutputTime = area.timestamp - maxZoomDurationMs;

            // Check for intersection with previous motion
            if (motions.length > 0) {
                const prevMotion = motions[motions.length - 1];
                const prevEndOutputTime = prevMotion.outputEndTimeMs;

                if (currentStartOutputTime < prevEndOutputTime) {
                    // Intersection detected - try shrinking duration
                    const availableGap = area.timestamp - prevEndOutputTime;

                    if (availableGap >= minZoomDurationMs) {
                        // Shrink duration to fit in the gap
                        motions.push({
                            id: crypto.randomUUID(),
                            outputEndTimeMs: area.timestamp,
                            durationMs: availableGap,
                            rect: targetViewport,
                            reason: area.reason,
                            type: 'auto'
                        });
                        lastViewport = targetViewport;
                        lastMustSeeRect = mustSeeRect;
                    } else {
                        // Not enough gap - merge zooms
                        const boundingRect: Rect = {
                            x: Math.min(lastMustSeeRect.x, mustSeeRect.x),
                            y: Math.min(lastMustSeeRect.y, mustSeeRect.y),
                            width: Math.max(lastMustSeeRect.x + lastMustSeeRect.width, mustSeeRect.x + mustSeeRect.width) - Math.min(lastMustSeeRect.x, mustSeeRect.x),
                            height: Math.max(lastMustSeeRect.y + lastMustSeeRect.height, mustSeeRect.y + mustSeeRect.height) - Math.min(lastMustSeeRect.y, mustSeeRect.y)
                        };

                        const mergedViewport = getViewport(boundingRect, maxZoom, viewMapper);
                        prevMotion.rect = mergedViewport;
                        lastViewport = mergedViewport;
                        lastMustSeeRect = boundingRect;
                    }
                } else {
                    // No intersection - add normally
                    motions.push({
                        id: crypto.randomUUID(),
                        outputEndTimeMs: area.timestamp,
                        durationMs: maxZoomDurationMs,
                        rect: targetViewport,
                        reason: area.reason,
                        type: 'auto'
                    });
                    lastViewport = targetViewport;
                    lastMustSeeRect = mustSeeRect;
                }
            } else {
                // First motion - add normally
                motions.push({
                    id: crypto.randomUUID(),
                    outputEndTimeMs: area.timestamp,
                    durationMs: maxZoomDurationMs,
                    rect: targetViewport,
                    reason: area.reason,
                    type: 'auto'
                });
                lastViewport = targetViewport;
                lastMustSeeRect = mustSeeRect;
            }
        }
    }

    // 4. Append final zoom out if needed
    const isFullZoom = Math.abs(lastViewport.width - outputVideoSize.width) < 1;

    if (!isFullZoom) {
        const zoomOutEndTime = zoomOutStartTime + ZOOM_TRANSITION_DURATION;

        motions.push({
            id: crypto.randomUUID(),
            outputEndTimeMs: zoomOutEndTime,
            durationMs: ZOOM_TRANSITION_DURATION,
            rect: { x: 0, y: 0, width: outputVideoSize.width, height: outputVideoSize.height },
            reason: 'end_zoomout',
            type: 'auto'
        });
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

        targetWidth = mappedTargetRect.width;
        targetHeight = mappedTargetRect.height;

        centerX = mappedTargetRect.x + mappedTargetRect.width / 2;
        centerY = mappedTargetRect.y + mappedTargetRect.height / 2;
    } else if (evt.type === EventType.URLCHANGE) {
        // URL Change -> Full View
        targetWidth = outputSize.width;
        targetHeight = outputSize.height;
        centerX = targetWidth / 2;
        centerY = targetHeight / 2;

    } else {
        // Click / Hover
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
    const minViewportHeight = minViewportWidth / aspectRatio;

    // Calculate viewport size needed to contain mustSeeRect while maintaining aspect ratio
    // Check which dimension is more constraining
    const widthBasedHeight = mustSeeRect.width / aspectRatio;
    const heightBasedWidth = mustSeeRect.height * aspectRatio;

    let viewportWidth: number;
    let viewportHeight: number;

    if (widthBasedHeight >= mustSeeRect.height) {
        // Width is the constraining dimension
        viewportWidth = mustSeeRect.width;
        viewportHeight = widthBasedHeight;
    } else {
        // Height is the constraining dimension
        viewportWidth = heightBasedWidth;
        viewportHeight = mustSeeRect.height;
    }

    // Ensure we don't exceed max zoom
    viewportWidth = Math.max(minViewportWidth, viewportWidth);
    viewportHeight = Math.max(minViewportHeight, viewportHeight);

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
    outputSize: Size
): Rect {
    const fullRect: Rect = { x: 0, y: 0, width: outputSize.width, height: outputSize.height };

    // 1. Prepare valid motions with computed start/end times in Output Space
    const validMotions = motions
        .map(m => {
            // OPTIMIZATION: Use cached outputEndTimeMs directly!
            const end = m.outputEndTimeMs;

            return {
                ...m,
                endTime: end,
                startTime: end - m.durationMs
            };
        })
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
