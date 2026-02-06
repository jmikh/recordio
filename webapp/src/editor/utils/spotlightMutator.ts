/**
 * Spotlight Mutator
 * 
 * All spotlight manipulation functions for window changes and manual operations.
 */

import type { Project, ZoomAction, SpotlightAction, SpotlightSettings, OutputWindow } from '../../types';
import { calculateAutoSpotlights, K_MIN_SPOTLIGHT_DURATION_MS } from '../../core/spotlight/spotlightScheduler';
import { ViewMapper } from '../../core/mappers/viewMapper';
import { TimeMapper } from '../../core/mappers/timeMapper';

// ============================================================================
// Helper Functions
// ============================================================================

const getWindowDuration = (w: OutputWindow): number => {
    const speed = w.speed || 1.0;
    return (w.endMs - w.startMs) / speed;
};

// ============================================================================
// Auto Spotlight Recalculation
// ============================================================================

/**
 * Recalculates auto spotlights synchronously.
 * Caller must provide the current zoomActions for viewport containment checks.
 */
export const recalculateAutoSpotlights = (
    project: Project,
    zoomActions: ZoomAction[]
): SpotlightAction[] => {
    if (project.settings.spotlight.isAuto) {
        const sourceSize = project.screenSource.size;

        if (!sourceSize || sourceSize.width === 0) {
            console.warn("Skipping spotlight recalc: Missing sourceSize");
            return project.timeline.spotlightActions;
        }

        const viewMapper = new ViewMapper(
            sourceSize,
            project.settings.outputSize,
            project.settings.screen.padding,
            project.settings.screen.crop
        );

        const timeMapper = new TimeMapper(project.timeline.outputWindows);

        return calculateAutoSpotlights(
            viewMapper,
            timeMapper,
            project.userEvents.hoveredCards || [],
            zoomActions,
            project.settings.zoom,
            project.settings.spotlight.enlargeScale
        );
    }

    return project.timeline.spotlightActions;
};

// ============================================================================
// Manual Spotlight Shifting (Window Start/End Changes)
// ============================================================================

/**
 * Shifts manual spotlights based on a time delta in output time.
 * @param spotlights Current list of spotlight actions
 * @param pivotTimeMs The point in output time where the change occurred
 * @param deltaMs The amount of time added (positive) or removed (negative)
 * @param minDurationMs Minimum spotlight duration (below this, spotlight is deleted)
 */
export const shiftManualSpotlights = (
    spotlights: SpotlightAction[],
    pivotTimeMs: number,
    deltaMs: number,
    minDurationMs: number
): SpotlightAction[] => {
    const absDelta = Math.abs(deltaMs);

    if (deltaMs > 0) {
        // Adding time: shift anything after the pivot forward
        return spotlights.map(s => {
            if (s.outputStartTimeMs >= pivotTimeMs) {
                // Entirely after pivot: shift both start and end
                return {
                    ...s,
                    outputStartTimeMs: s.outputStartTimeMs + deltaMs,
                    outputEndTimeMs: s.outputEndTimeMs + deltaMs
                };
            } else if (s.outputEndTimeMs > pivotTimeMs) {
                // Straddles pivot: only shift end
                return {
                    ...s,
                    outputEndTimeMs: s.outputEndTimeMs + deltaMs
                };
            }
            return s;
        });
    } else {
        // Removing time (Backward Shift)
        const deleteRangeStart = pivotTimeMs;
        const deleteRangeEnd = pivotTimeMs + absDelta;
        const result: SpotlightAction[] = [];

        for (const s of spotlights) {
            const startTime = s.outputStartTimeMs;
            const endTime = s.outputEndTimeMs;

            // Case 1: Entirely before deleted range - unchanged
            if (endTime <= deleteRangeStart) {
                result.push(s);
                continue;
            }

            // Case 2: Starts and ends within deleted range - delete entirely
            if (startTime >= deleteRangeStart && endTime <= deleteRangeEnd) {
                continue;
            }

            // Case 3: Entirely after deleted range - shift backward
            if (startTime >= deleteRangeEnd) {
                result.push({
                    ...s,
                    outputStartTimeMs: startTime - absDelta,
                    outputEndTimeMs: endTime - absDelta
                });
                continue;
            }

            // Case 4: Starts before deleted range but ends during it
            if (startTime < deleteRangeStart && endTime > deleteRangeStart && endTime <= deleteRangeEnd) {
                const newEndTime = deleteRangeStart;
                const newDuration = newEndTime - startTime;
                if (newDuration >= minDurationMs) {
                    result.push({
                        ...s,
                        outputEndTimeMs: newEndTime
                    });
                }
                continue;
            }

            // Case 5: Starts during deleted range but ends after it
            if (startTime >= deleteRangeStart && startTime < deleteRangeEnd && endTime > deleteRangeEnd) {
                const newStartTime = deleteRangeStart;
                const newEndTime = endTime - absDelta;
                const newDuration = newEndTime - newStartTime;
                if (newDuration >= minDurationMs) {
                    result.push({
                        ...s,
                        outputStartTimeMs: newStartTime,
                        outputEndTimeMs: newEndTime
                    });
                }
                continue;
            }

            // Case 6: Spans entirely across deleted range (starts before, ends after)
            if (startTime < deleteRangeStart && endTime > deleteRangeEnd) {
                const newEndTime = endTime - absDelta;
                const newDuration = newEndTime - startTime;
                if (newDuration >= minDurationMs) {
                    result.push({
                        ...s,
                        outputEndTimeMs: newEndTime
                    });
                }
                continue;
            }
        }

        return result;
    }
};

// ============================================================================
// Manual Spotlight Speed Scaling
// ============================================================================

/**
 * Scales spotlights proportionally when window speed changes.
 * Similar to zoom scaling but uses start/end times instead of end/duration.
 */
export const scaleSpotlightsForSpeedChange = (
    spotlights: SpotlightAction[],
    windowOutputStart: number,
    oldDuration: number,
    newDuration: number,
    minDurationMs: number
): SpotlightAction[] => {
    const windowOutputEnd = windowOutputStart + oldDuration;
    const durationDelta = newDuration - oldDuration;

    const result: SpotlightAction[] = [];

    for (const s of spotlights) {
        const startTime = s.outputStartTimeMs;
        const endTime = s.outputEndTimeMs;

        // Before window: unchanged
        if (endTime <= windowOutputStart) {
            result.push(s);
            continue;
        }

        // After window: shift by duration delta
        if (startTime >= windowOutputEnd) {
            result.push({
                ...s,
                outputStartTimeMs: startTime + durationDelta,
                outputEndTimeMs: endTime + durationDelta
            });
            continue;
        }

        // Within or overlapping the window: scale proportionally
        // Calculate relative positions within the old window (0 to 1)
        const relativeStart = Math.max(0, (startTime - windowOutputStart) / oldDuration);
        const relativeEnd = Math.min(1, (endTime - windowOutputStart) / oldDuration);

        // Apply relative positions to new window duration
        let newStartTime = windowOutputStart + (relativeStart * newDuration);
        let newEndTime = windowOutputStart + (relativeEnd * newDuration);

        // If spotlight started before window, preserve original start
        if (startTime < windowOutputStart) {
            newStartTime = startTime;
        }

        // If spotlight ended after window, apply delta to end
        if (endTime > windowOutputEnd) {
            newEndTime = endTime + durationDelta;
        }

        const spotlightDuration = newEndTime - newStartTime;
        if (spotlightDuration >= minDurationMs) {
            result.push({
                ...s,
                outputStartTimeMs: newStartTime,
                outputEndTimeMs: newEndTime
            });
        }
        // else: spotlight too small after scaling, drop it
    }

    return result;
};

// ============================================================================
// Orchestration: Handle Window Changes
// ============================================================================

export interface SpotlightWindowChangeParams {
    outputStartMs: number;
    oldStart: number;
    oldEnd: number;
    oldSpeed: number;
    oldDuration: number;
    newWindow: OutputWindow;
    spotlightSettings: SpotlightSettings;
}

/**
 * Orchestrates all spotlight updates for a window change (start, end, or speed).
 * Returns updated spotlight actions.
 */
export const handleSpotlightWindowChange = (
    spotlights: SpotlightAction[],
    params: SpotlightWindowChangeParams,
    isAuto: boolean,
    project: Project,
    zoomActions: ZoomAction[]
): SpotlightAction[] => {
    if (isAuto) {
        return recalculateAutoSpotlights(project, zoomActions);
    }

    let nextSpotlights = [...spotlights];
    const { outputStartMs, oldStart, oldEnd, oldSpeed, oldDuration, newWindow, spotlightSettings } = params;
    const minDuration = K_MIN_SPOTLIGHT_DURATION_MS;
    const newSpeed = newWindow.speed || 1.0;

    // 1. Handle Start Change (Trimming/Extending from LEFT)
    if (newWindow.startMs !== oldStart) {
        const delta = oldStart - newWindow.startMs;
        nextSpotlights = shiftManualSpotlights(nextSpotlights, outputStartMs, delta, minDuration);
    }

    // 2. Handle End Change (Trimming/Extending from RIGHT)
    if (newWindow.endMs !== oldEnd) {
        const delta = newWindow.endMs - oldEnd;
        const pivot = outputStartMs + oldDuration;
        nextSpotlights = shiftManualSpotlights(nextSpotlights, pivot, delta, minDuration);
    }

    // 3. Handle Speed Change
    if (newSpeed !== oldSpeed) {
        const newDuration = getWindowDuration(newWindow);
        nextSpotlights = scaleSpotlightsForSpeedChange(
            nextSpotlights,
            outputStartMs,
            oldDuration,
            newDuration,
            minDuration
        );
    }

    return nextSpotlights;
};

/**
 * Handles spotlight updates when a window is removed.
 */
export const handleSpotlightWindowRemoval = (
    spotlights: SpotlightAction[],
    outputStartMs: number,
    windowDuration: number,
    spotlightSettings: SpotlightSettings,
    isAuto: boolean,
    project: Project,
    zoomActions: ZoomAction[]
): SpotlightAction[] => {
    if (isAuto) {
        return recalculateAutoSpotlights(project, zoomActions);
    }

    return shiftManualSpotlights(spotlights, outputStartMs, -windowDuration, K_MIN_SPOTLIGHT_DURATION_MS);
};
