import { type ZoomAction, type Size, type Rect, type ZoomSettings, type FocusArea } from '../../types';
import { ViewMapper } from '../mappers/viewMapper';
import { TimeMapper } from '../mappers/timeMapper';
import { rectContainsRect, clampViewportToBounds } from '../geometry';
import { applyEasing } from '../easing';

export * from '../mappers/viewMapper';

// ============================================================================
// Core Abstractions
// ============================================================================

/**
 * Calculates zoom actions from focus areas.
 * 
 * Focus areas are in output time (when events happen in the final video).
 * Zoom actions now store sourceEndTimeMs instead of outputEndTimeMs.
 * Duration is derived dynamically based on settings and spacing.
 * 
 * @param zoomSettings - Zoom settings including maxZoom, minZoomDurationMs, maxZoomDurationMs
 * @param viewMapper - Mapper for source to output coordinate transformation
 * @param focusAreas - Focus areas computed from user events (in output time)
 * @param timeMapper - TimeMapper to convert output time back to source time
 * @returns Array of zoom actions with sourceEndTimeMs
 */
export function calculateZoomSchedule(
    zoomSettings: ZoomSettings,
    viewMapper: ViewMapper,
    focusAreas: FocusArea[],
    timeMapper: TimeMapper
): ZoomAction[] {
    const { maxZoom, maxZoomDurationMs, minZoomDurationMs } = zoomSettings;

    if (focusAreas.length === 0) return [];

    const actions: ZoomAction[] = [];
    const outputVideoSize = viewMapper.outputVideoSize;
    let lastViewport: Rect = { x: 0, y: 0, width: outputVideoSize.width, height: outputVideoSize.height };
    let lastMustSeeRect: Rect = lastViewport;
    let lastOutputEndTime = 0;

    // Process each focus area (focus areas are in output time)
    for (const area of focusAreas) {
        // Use the focus area rect directly (already in source coordinates)
        // Map it to output coordinates for viewport calculation
        const mappedFocusRect = viewMapper.inputToOutputRect(area.rect);

        // The must-see rect is the focus area itself
        let mustSeeRect: Rect = mappedFocusRect;
        let targetViewport: Rect;

        // If the focus area spans the full source viewport, zoom fully out.
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

        let shouldGenerateAction = (!mustSeeFits || sizeChanged);

        if (shouldGenerateAction) {
            const outputEndTime = area.timestamp; // Focus area timestamp is in output time
            const availableGap = outputEndTime - lastOutputEndTime;

            // Only add action if there's enough gap for minimum duration
            if (availableGap >= minZoomDurationMs) {
                // Convert output end time to source time
                const sourceEndTimeMs = timeMapper.mapOutputToSourceTime(outputEndTime);

                // Skip if the output time doesn't map to a valid source time
                if (sourceEndTimeMs === -1) {
                    continue;
                }

                actions.push({
                    id: crypto.randomUUID(),
                    sourceEndTimeMs,
                    rect: targetViewport,
                    reason: area.reason,
                    type: 'auto'
                });

                lastViewport = targetViewport;
                lastMustSeeRect = mustSeeRect;
                lastOutputEndTime = outputEndTime;
            } else {
                // Not enough gap - merge zooms
                if (actions.length > 0) {
                    const prevAction = actions[actions.length - 1];
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
    const widthBasedHeight = mustSeeRect.width / aspectRatio;
    const heightBasedWidth = mustSeeRect.height * aspectRatio;

    let viewportWidth: number;
    let viewportHeight: number;

    if (widthBasedHeight >= mustSeeRect.height) {
        viewportWidth = mustSeeRect.width;
        viewportHeight = widthBasedHeight;
    } else {
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
 * Prepared zoom action with computed output times and duration.
 * Used internally for viewport interpolation.
 */
interface PreparedZoomAction extends ZoomAction {
    outputEndTime: number;
    outputStartTime: number;
    duration: number;
}

/**
 * Prepares zoom actions for interpolation by converting source times to output times
 * and calculating dynamic durations.
 * 
 * Duration is calculated as: min(maxZoomDurationMs, gap to previous zoom)
 * clamped to at least minZoomDurationMs.
 */
export function prepareZoomActionsForInterpolation(
    actions: ZoomAction[],
    timeMapper: TimeMapper,
    zoomSettings: ZoomSettings
): PreparedZoomAction[] {
    const { maxZoomDurationMs, minZoomDurationMs } = zoomSettings;

    // Convert source times to output times and filter out invisible zooms
    const visibleActions = actions
        .map(action => {
            const outputEndTime = timeMapper.mapSourceToOutputTime(action.sourceEndTimeMs);
            return { action, outputEndTime };
        })
        .filter(({ outputEndTime }) => outputEndTime !== -1)
        .sort((a, b) => a.outputEndTime - b.outputEndTime);

    const prepared: PreparedZoomAction[] = [];
    let prevOutputEndTime = 0;

    for (const { action, outputEndTime } of visibleActions) {
        // Calculate available space before this zoom
        const availableSpace = outputEndTime - prevOutputEndTime;

        // Duration: use maxZoomDurationMs, but clamp to available space
        const duration = Math.max(
            minZoomDurationMs,
            Math.min(maxZoomDurationMs, availableSpace)
        );

        prepared.push({
            ...action,
            outputEndTime,
            outputStartTime: outputEndTime - duration,
            duration
        });

        prevOutputEndTime = outputEndTime;
    }

    return prepared;
}

/**
 * Calculates the exact state (x, y, width, height) of the viewport at a given output time.
 *
 * It replays the sequence of zoom actions up to the requested time,
 * handling interpolation between states.
 *
 * **Intersection Behavior:**
 * If a new action starts before the previous action has completed (an intersection),
 * the previous action is \"interrupted\" at the exact start time of the incoming action.
 * The calculated viewport state at that moment of interruption becomes the starting
 * state for the new action. This ensures continuous, smooth transitions even when
 * events occur rapidly and overlap.
 * 
 * @param actions - Zoom actions with sourceEndTimeMs
 * @param outputTimeMs - Output time to calculate viewport for
 * @param outputSize - Output video size
 * @param timeMapper - TimeMapper for source to output time conversion
 * @param zoomSettings - Zoom settings for duration calculation
 */
export function getViewportStateAtTime(
    actions: ZoomAction[],
    outputTimeMs: number,
    outputSize: Size,
    timeMapper: TimeMapper,
    zoomSettings: ZoomSettings
): Rect {
    const fullRect: Rect = { x: 0, y: 0, width: outputSize.width, height: outputSize.height };

    // Prepare actions with output times and calculated durations
    const preparedActions = prepareZoomActionsForInterpolation(actions, timeMapper, zoomSettings);

    if (preparedActions.length === 0) {
        return fullRect;
    }

    let currentRect = fullRect;

    for (let i = 0; i < preparedActions.length; i++) {
        const action = preparedActions[i];
        const nextAction = preparedActions[i + 1];

        // The time until which this action is the "active" governing action
        const interruptionTime = nextAction ? nextAction.outputStartTime : Number.POSITIVE_INFINITY;

        // If the current output time is BEFORE this action even starts,
        // we are in a gap before this action.
        if (outputTimeMs < action.outputStartTime) {
            return currentRect;
        }

        // We are currently INSIDE or AFTER this action's start.
        const timeLimit = Math.min(outputTimeMs, interruptionTime);

        // Calculate progress relative to the action's FULL duration
        const elapsed = timeLimit - action.outputStartTime;
        const progress = Math.max(0, Math.min(1, elapsed / action.duration));
        const eased = applyEasing(progress, zoomSettings.easing ?? 'ease-in-out');

        const interpolated = interpolateRect(currentRect, action.rect, eased);

        // If our lookup time was within this segment, we are done!
        if (outputTimeMs <= interruptionTime) {
            return interpolated;
        }

        // Otherwise, we have passed this segment
        currentRect = interpolated;
    }

    return currentRect;
}

function interpolateRect(from: Rect, to: Rect, t: number): Rect {
    return {
        x: from.x + (to.x - from.x) * t,
        y: from.y + (to.y - from.y) * t,
        width: from.width + (to.width - from.width) * t,
        height: from.height + (to.height - from.height) * t,
    };
}
