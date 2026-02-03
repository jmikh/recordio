import { type ZoomAction, type Size, type Rect, type ZoomSettings, type FocusArea } from '../types';
import { ViewMapper } from '../mappers/viewMapper';
import { rectContainsRect, clampViewportToBounds } from '../geometry';

export * from '../mappers/viewMapper';

// ============================================================================
// Core Abstractions
// ============================================================================

export function calculateZoomSchedule(
    zoomSettings: ZoomSettings,
    viewMapper: ViewMapper,
    focusAreas: FocusArea[]
): ZoomAction[] {
    const { maxZoom, maxZoomDurationMs, minZoomDurationMs } = zoomSettings;

    if (focusAreas.length === 0) return [];



    const actions: ZoomAction[] = [];
    const outputVideoSize = viewMapper.outputVideoSize;
    let lastViewport: Rect = { x: 0, y: 0, width: outputVideoSize.width, height: outputVideoSize.height };
    let lastMustSeeRect: Rect = lastViewport;

    // Process each focus area (start/end buffer logic and final_zoomout now handled by focusManager)
    for (const area of focusAreas) {

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

        const mustSeeFits = rectContainsRect(lastViewport, mustSeeRect);
        const sizeChanged = Math.abs(targetViewport.width - lastViewport.width) > 0.1;

        let shouldGenerateAction = (!mustSeeFits || sizeChanged)

        if (shouldGenerateAction) {
            const currentStartOutputTime = area.timestamp - maxZoomDurationMs;

            // Check for intersection with previous action
            if (actions.length > 0) {
                const prevAction = actions[actions.length - 1];
                const prevEndOutputTime = prevAction.outputEndTimeMs;

                if (currentStartOutputTime < prevEndOutputTime) {
                    // Intersection detected - try shrinking duration
                    const availableGap = area.timestamp - prevEndOutputTime;

                    if (availableGap >= minZoomDurationMs) {
                        // Shrink duration to fit in the gap
                        actions.push({
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
                        prevAction.rect = mergedViewport;
                        lastViewport = mergedViewport;
                        lastMustSeeRect = boundingRect;
                    }
                } else {
                    // No intersection - add normally
                    actions.push({
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
                // First action - add normally
                actions.push({
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

    return actions;
}

function getViewport(
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

    return clampViewportToBounds(viewport, outputSize);
}

// ============================================================================
// Runtime Execution / Interpolation (Output Space)
// ============================================================================

/**
 * Calculates the exact state (x, y, width, height) of the viewport at a given output time.
 *
 * It replays the sequence of zoom actions up to the requested time,
 * handling interpolation between states.
 *
 * **Intersection Behavior:**
 * If a new action starts before the previous action has completed (an intersection),
 * the previous action is "interrupted" at the exact start time of the incoming action.
 * The calculated viewport state at that moment of interruption becomes the starting
 * state for the new action. This ensures continuous, smooth transitions even when
 * events occur rapidly and overlap.
 */
export function getViewportStateAtTime(
    actions: ZoomAction[],
    outputTimeMs: number,
    outputSize: Size
): Rect {
    const fullRect: Rect = { x: 0, y: 0, width: outputSize.width, height: outputSize.height };

    // 1. Prepare valid actions with computed start/end times in Output Space
    const validActions = actions
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

    for (let i = 0; i < validActions.length; i++) {
        const action = validActions[i];
        const nextAction = validActions[i + 1];

        // The time until which this action is the "active" governing action
        // It rules until it finishes OR until the next action starts (interruption)
        const interruptionTime = nextAction ? nextAction.startTime : Number.POSITIVE_INFINITY;

        // If the current output time is BEFORE this action even starts,
        // implies we are in a gap before this action.
        // We should just return the currentRect (result of previous chain).
        if (outputTimeMs < action.startTime) {
            return currentRect;
        }

        // We are currently INSIDE or AFTER this action's start.

        // Define the target time we want to simulate to in this step.
        // It is either the current lookup time (if we found our frame),
        // or the interruption time (start of next action).
        const timeLimit = Math.min(outputTimeMs, interruptionTime);

        // Calculate progress relative to the action's FULL duration (to preserve speed/easing curve)
        const elapsed = timeLimit - action.startTime;
        const progress = Math.max(0, Math.min(1, elapsed / action.durationMs));
        const eased = applyEasing(progress);

        const interpolated = interpolateRect(currentRect, action.rect, eased);

        // If our lookup time was within this segment, we are done!
        if (outputTimeMs <= interruptionTime) {
            return interpolated;
        }

        // Otherwise, we have passed this segment (action finished or interrupted).
        // The 'interpolated' rect becomes the starting point for the next action.
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
