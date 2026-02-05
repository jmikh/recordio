/**
 * Zoom Mutator
 * 
 * All zoom manipulation functions for window changes and manual operations.
 */

import type { Project, UserEvents, ZoomAction, ZoomSettings, FocusArea, OutputWindow } from '../../types';
import { calculateZoomSchedule, ViewMapper, getAllFocusAreas } from '../../core/zoom';
import { getTimeMapper } from '../hooks/useTimeMapper';

// ============================================================================
// Helper Functions
// ============================================================================

const getWindowDuration = (w: OutputWindow): number => {
    const speed = w.speed || 1.0;
    return (w.endMs - w.startMs) / speed;
};

// ============================================================================
// Focus Area Computation
// ============================================================================

/**
 * Computes focus areas from user events and output windows.
 * Called when output windows change to update the cached focusAreas in timeline.
 */
export const computeFocusAreas = (
    project: Project,
    events: UserEvents
): FocusArea[] => {
    const sourceSize = project.screenSource.size;

    if (!sourceSize || sourceSize.width === 0) {
        console.warn("Skipping focus area computation: Missing sourceSize");
        return [];
    }

    const timeMapper = getTimeMapper(project.timeline.outputWindows);
    return getAllFocusAreas(events, timeMapper, sourceSize);
};

// ============================================================================
// Auto Zoom Recalculation
// ============================================================================

/**
 * Helper to recalculate zooms synchronously using pre-computed focus areas.
 * focusAreas should already be stored in project.timeline.focusAreas.
 */
export const recalculateAutoZooms = (
    project: Project
): ZoomAction[] => {
    if (project.settings.zoom.isAuto) {
        const sourceSize = project.screenSource.size;

        if (!sourceSize || sourceSize.width === 0) {
            console.warn("Skipping zoom recalc: Missing sourceSize");
            return project.timeline.zoomActions;
        }

        const viewMapper = new ViewMapper(
            sourceSize,
            project.settings.outputSize,
            project.settings.screen.padding,
            project.settings.screen.crop
        );

        const focusAreas = project.timeline.focusAreas;

        return calculateZoomSchedule(
            project.settings.zoom,
            viewMapper,
            focusAreas
        );
    }

    return project.timeline.zoomActions;
};

// ============================================================================
// Manual Zoom Duration Updates
// ============================================================================

/**
 * Updates the duration of all manual zooms while preserving their end time.
 * If extending backwards causes a collision with the previous block, it is clamped.
 */
export const updateManualZoomDuration = (
    actions: ZoomAction[],
    targetDurationMs: number
): ZoomAction[] => {
    const sortedActions = [...actions].sort((a, b) => a.outputEndTimeMs - b.outputEndTimeMs);
    const result: ZoomAction[] = [];
    let leftBoundary = 0;

    for (const m of sortedActions) {
        let newEndTime = m.outputEndTimeMs;
        let newDuration = targetDurationMs;
        let newStartTime = newEndTime - newDuration;

        if (newStartTime < leftBoundary) {
            newStartTime = leftBoundary;
            newDuration = newEndTime - newStartTime;
        }

        result.push({
            ...m,
            durationMs: newDuration
        });
        leftBoundary = newEndTime;
    }

    return result;
};

// ============================================================================
// Manual Zoom Shifting (Window Start/End Changes)
// ============================================================================

/**
 * Shifts manual zooms based on a time delta in output time.
 */
export const shiftManualZooms = (
    actions: ZoomAction[],
    pivotTimeMs: number,
    deltaMs: number,
    minZoomDurationMs: number,
    maxZoomDurationMs: number
): ZoomAction[] => {
    const absDelta = Math.abs(deltaMs);

    if (deltaMs > 0) {
        return actions.map(m => {
            if (m.outputEndTimeMs > pivotTimeMs) {
                return {
                    ...m,
                    outputEndTimeMs: m.outputEndTimeMs + deltaMs
                };
            }
            return m;
        });
    } else {
        // Removing time (Backward Shift)
        const deleteRangeStart = pivotTimeMs;
        const deleteRangeEnd = pivotTimeMs + absDelta;

        const candidates = actions.filter(m => {
            if (m.outputEndTimeMs > deleteRangeStart && m.outputEndTimeMs <= deleteRangeEnd) {
                return false;
            }
            return true;
        });

        const result: ZoomAction[] = [];
        let leftBoundary = 0;

        for (const m of candidates) {
            if (m.outputEndTimeMs <= deleteRangeStart) {
                result.push(m);
                leftBoundary = m.outputEndTimeMs;
                continue;
            } else if (m.outputEndTimeMs <= deleteRangeEnd) {
                continue;
            }

            const newEndTime = m.outputEndTimeMs - absDelta;
            let newDuration = maxZoomDurationMs;
            const idealStartTime = newEndTime - newDuration;

            if (idealStartTime >= leftBoundary) {
                result.push({
                    ...m,
                    outputEndTimeMs: newEndTime,
                    durationMs: newDuration
                });
                leftBoundary = newEndTime;
            } else {
                const newStartTime = leftBoundary;
                newDuration = newEndTime - newStartTime;

                if (newDuration >= minZoomDurationMs) {
                    result.push({
                        ...m,
                        outputEndTimeMs: newEndTime,
                        durationMs: newDuration
                    });
                    leftBoundary = newEndTime;
                }
            }
        }

        return result;
    }
};

// ============================================================================
// Manual Zoom Speed Scaling
// ============================================================================

/**
 * Scales zooms proportionally when window speed changes.
 */
export const scaleZoomsForSpeedChange = (
    actions: ZoomAction[],
    windowOutputStart: number,
    oldDuration: number,
    newDuration: number,
    oldSpeed: number,
    newSpeed: number,
    zoomSettings: ZoomSettings
): ZoomAction[] => {
    const windowOutputEnd = windowOutputStart + oldDuration;
    const durationDelta = newDuration - oldDuration;

    const beforeWindow: ZoomAction[] = [];
    const withinWindow: ZoomAction[] = [];
    const afterWindow: ZoomAction[] = [];

    actions.forEach(m => {
        if (m.outputEndTimeMs <= windowOutputStart) {
            beforeWindow.push(m);
        } else if (m.outputEndTimeMs <= windowOutputEnd) {
            withinWindow.push(m);
        } else {
            afterWindow.push(m);
        }
    });

    // Scale zooms within the window
    const speedRatio = newSpeed / oldSpeed;
    let leftBoundary = windowOutputStart;
    const adjustedWithinWindow: ZoomAction[] = [];

    for (const m of withinWindow) {
        const relativePosition = (m.outputEndTimeMs - windowOutputStart) / oldDuration;
        const newEndTime = windowOutputStart + (relativePosition * newDuration);
        const scaledDuration = m.durationMs / speedRatio;

        let finalDuration = Math.min(
            zoomSettings.maxZoomDurationMs,
            Math.max(scaledDuration, zoomSettings.minZoomDurationMs)
        );

        const idealStartTime = newEndTime - finalDuration;

        if (idealStartTime >= leftBoundary) {
            adjustedWithinWindow.push({
                ...m,
                outputEndTimeMs: newEndTime,
                durationMs: finalDuration
            });
            leftBoundary = newEndTime;
        } else {
            const availableSpace = newEndTime - leftBoundary;

            if (availableSpace >= zoomSettings.minZoomDurationMs) {
                adjustedWithinWindow.push({
                    ...m,
                    outputEndTimeMs: newEndTime,
                    durationMs: availableSpace
                });
                leftBoundary = newEndTime;
            }
        }
    }

    // Shift zooms after the window
    const shiftedAfterWindow = afterWindow.map(m => ({
        ...m,
        outputEndTimeMs: m.outputEndTimeMs + durationDelta
    }));

    return [
        ...beforeWindow,
        ...adjustedWithinWindow,
        ...shiftedAfterWindow
    ];
};

// ============================================================================
// Orchestration: Handle Window Changes
// ============================================================================

export interface WindowChangeParams {
    outputStartMs: number;
    oldStart: number;
    oldEnd: number;
    oldSpeed: number;
    oldDuration: number;
    newWindow: OutputWindow;
    zoomSettings: ZoomSettings;
}

/**
 * Orchestrates all zoom updates for a window change (start, end, or speed).
 * Returns updated zoom actions.
 */
export const handleZoomWindowChange = (
    actions: ZoomAction[],
    params: WindowChangeParams,
    isAuto: boolean,
    project: Project
): ZoomAction[] => {
    if (isAuto) {
        return recalculateAutoZooms(project);
    }

    let nextActions = [...actions];
    const { outputStartMs, oldStart, oldEnd, oldSpeed, oldDuration, newWindow, zoomSettings } = params;
    const newSpeed = newWindow.speed || 1.0;

    // 1. Handle Start Change (Trimming/Extending from LEFT)
    if (newWindow.startMs !== oldStart) {
        const delta = oldStart - newWindow.startMs;
        nextActions = shiftManualZooms(nextActions, outputStartMs, delta, zoomSettings.minZoomDurationMs, zoomSettings.maxZoomDurationMs);
    }

    // 2. Handle End Change (Trimming/Extending from RIGHT)
    if (newWindow.endMs !== oldEnd) {
        const delta = newWindow.endMs - oldEnd;
        const pivot = outputStartMs + oldDuration;
        nextActions = shiftManualZooms(nextActions, pivot, delta, zoomSettings.minZoomDurationMs, zoomSettings.maxZoomDurationMs);
    }

    // 3. Handle Speed Change
    if (newSpeed !== oldSpeed) {
        const newDuration = getWindowDuration(newWindow);
        nextActions = scaleZoomsForSpeedChange(
            nextActions,
            outputStartMs,
            oldDuration,
            newDuration,
            oldSpeed,
            newSpeed,
            zoomSettings
        );
    }

    return nextActions;
};

/**
 * Handles zoom updates when a window is removed.
 */
export const handleZoomWindowRemoval = (
    actions: ZoomAction[],
    outputStartMs: number,
    windowDuration: number,
    zoomSettings: ZoomSettings,
    isAuto: boolean,
    project: Project
): ZoomAction[] => {
    if (isAuto) {
        return recalculateAutoZooms(project);
    }

    return shiftManualZooms(actions, outputStartMs, -windowDuration, zoomSettings.minZoomDurationMs, zoomSettings.maxZoomDurationMs);
};
