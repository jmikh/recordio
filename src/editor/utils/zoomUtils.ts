
import type { ID, Project, UserEvents, ZoomAction, FocusArea } from '../../core/types';
import { calculateZoomSchedule, ViewMapper, getAllFocusAreas } from '../../core/zoom';
import { getTimeMapper } from '../hooks/useTimeMapper';

/**
 * Computes focus areas from user events and output windows.
 * Called when output windows change to update the cached focusAreas in timeline.
 */
export const computeFocusAreas = (
    project: Project,
    sources: Record<ID, import('../../core/types').SourceMetadata>,
    events: UserEvents
): FocusArea[] => {
    const screenSourceId = project.timeline.screenSourceId;
    const sourceMetadata = sources[screenSourceId];

    if (!sourceMetadata) {
        console.warn("Skipping focus area computation: Missing source", screenSourceId);
        return [];
    }

    const timeMapper = getTimeMapper(project.timeline.outputWindows);
    return getAllFocusAreas(events, timeMapper, sourceMetadata.size);
};

/**
 * Helper to recalculate zooms synchronously using pre-computed focus areas.
 * focusAreas should already be stored in project.timeline.focusAreas.
 */
export const recalculateAutoZooms = (
    project: Project,
    sources: Record<ID, import('../../core/types').SourceMetadata>
): ZoomAction[] => {
    // 1. If Auto Zoom is ON, regenerate completely
    if (project.settings.zoom.isAuto) {
        const screenSourceId = project.timeline.screenSourceId;
        const sourceMetadata = sources[screenSourceId];

        if (!sourceMetadata) {
            console.warn("Skipping zoom recalc: Missing source", screenSourceId);
            return project.timeline.zoomActions;
        }

        const viewMapper = new ViewMapper(
            sourceMetadata.size,
            project.settings.outputSize,
            project.settings.screen.padding,
            project.settings.screen.crop
        );

        // Use pre-computed focus areas from timeline
        const focusAreas = project.timeline.focusAreas;

        return calculateZoomSchedule(
            project.settings.zoom,
            viewMapper,
            focusAreas
        );
    }

    return project.timeline.zoomActions;
};


/**
 * Updates the duration of all manual zooms while preserving their end time.
 * If extending backwards causes a collision with the previous block, it is clamped.
 */
export const updateManualZoomDuration = (
    actions: ZoomAction[],
    targetDurationMs: number
): ZoomAction[] => {
    // Sort to handle left-to-right collision logic
    const sortedActions = [...actions].sort((a, b) => a.outputEndTimeMs - b.outputEndTimeMs);
    const result: ZoomAction[] = [];
    let leftBoundary = 0;

    for (const m of sortedActions) {
        // Calculate ideal start time based on fixed end time
        let newEndTime = m.outputEndTimeMs;
        let newDuration = targetDurationMs;
        let newStartTime = newEndTime - newDuration;

        // Check collision with previous block
        if (newStartTime < leftBoundary) {
            newStartTime = leftBoundary;
            newDuration = newEndTime - newStartTime;
        }

        result.push({
            ...m,
            durationMs: newDuration
            // outputEndTimeMs remains preserved
        });
        leftBoundary = newEndTime;
    }

    return result;
};


/**
 * Shifts manual zooms based on a time delta in output time.
 * @param motions Current list of viewport motions
 * @param pivotTimeMs The point in output time where the change occurred
 * @param deltaMs The amount of time added (positive) or removed (negative)
 */
export const shiftManualZooms = (
    actions: ZoomAction[],
    pivotTimeMs: number,
    deltaMs: number,
    minZoomDurationMs: number,
    maxZoomDurationMs: number
): ZoomAction[] => {
    let nextActions = [...actions];

    const absDelta = Math.abs(deltaMs);

    if (deltaMs > 0) {
        return nextActions.map(m => {
            // For simple implementation: if the motion's end time is > pivot, shift it.
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

        // 1. Filter out items that end strictly inside the deleted range
        // Note: Items that *start* inside but *end* outside will be shifted (shortened from start)
        const candidates = nextActions.filter(m => {
            if (m.outputEndTimeMs > deleteRangeStart && m.outputEndTimeMs <= deleteRangeEnd) {
                return false;
            }
            return true;
        });

        const result: ZoomAction[] = [];
        let leftBoundary = 0;
        console.log("deleteRangeStart", deleteRangeStart);
        console.log("deleteRangeEnd", deleteRangeEnd);
        let i = 0;
        for (const m of candidates) {
            console.log("i=", i++, " m", m);
            if (m.outputEndTimeMs <= deleteRangeStart) {
                console.log("pushing before delete range", m.outputEndTimeMs, deleteRangeStart);
                result.push(m);
                leftBoundary = m.outputEndTimeMs;
                continue;
            } else if (m.outputEndTimeMs <= deleteRangeEnd) {
                console.log("skipping in delete range")
                continue;
            }

            let newEndTime = m.outputEndTimeMs - absDelta;

            // Try to expand to max duration
            let newDuration = maxZoomDurationMs;
            const idealStartTime = newEndTime - newDuration;

            if (idealStartTime >= leftBoundary) {
                console.log("pushing after left boundary", idealStartTime, leftBoundary);
                result.push({
                    ...m,
                    outputEndTimeMs: newEndTime,
                    durationMs: newDuration
                });
                leftBoundary = newEndTime;
            } else {
                // We need to shrink the block (collision with leftBoundary)
                const newStartTime = leftBoundary;
                const newDuration = newEndTime - newStartTime;

                if (newDuration >= minZoomDurationMs) {
                    console.log("pushing after shrinking");
                    // Fits with shortening
                    result.push({
                        ...m,
                        outputEndTimeMs: newEndTime,
                        durationMs: newDuration
                    });
                    leftBoundary = newEndTime;
                } else {
                    // Gap too small, drop it.
                    console.log('Dropping block due to collision', { newDuration, minZoomDurationMs, leftBoundary });
                }
            }
        }

        return result;
    }
};
