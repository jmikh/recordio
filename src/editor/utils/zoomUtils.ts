
import type { ID, Project, UserEvents, ViewportMotion } from '../../core/types';
import { calculateZoomSchedule, ViewMapper } from '../../core/viewportMotion';
import { getAllFocusAreas } from '../../core/focusManager';
import { getTimeMapper } from '../hooks/useTimeMapper';


/**
 * Helper to recalculate zooms synchronously
 */
export const recalculateAutoZooms = (
    project: Project,
    sources: Record<ID, import('../../core/types').SourceMetadata>,
    events: UserEvents
): ViewportMotion[] => {
    // 1. If Auto Zoom is ON, regenerate completely
    if (project.settings.zoom.autoZoom) {
        const screenSourceId = project.timeline.screenSourceId;
        const sourceMetadata = sources[screenSourceId];

        if (!sourceMetadata) {
            console.warn("Skipping zoom recalc: Missing source or events", screenSourceId);
            return project.timeline.viewportMotions;
        }

        const viewMapper = new ViewMapper(
            sourceMetadata.size,
            project.settings.outputSize,
            project.settings.screen.padding,
            project.settings.screen.crop
        );

        const timeMapper = getTimeMapper(project.timeline.outputWindows);
        const focusAreas = getAllFocusAreas(events, timeMapper, sourceMetadata.size);
        const outputDuration = timeMapper.getOutputDuration();

        return calculateZoomSchedule(
            project.settings.zoom,
            viewMapper,
            focusAreas,
            outputDuration
        );
    }

    return project.timeline.viewportMotions;
};


/**
 * Updates the duration of all manual zooms while preserving their end time.
 * If extending backwards causes a collision with the previous block, it is clamped.
 */
export const updateManualZoomDuration = (
    motions: ViewportMotion[],
    targetDurationMs: number
): ViewportMotion[] => {
    // Sort to handle left-to-right collision logic
    const sortedMotions = [...motions].sort((a, b) => a.outputEndTimeMs - b.outputEndTimeMs);
    const result: ViewportMotion[] = [];
    let leftBoundary = 0;

    for (const m of sortedMotions) {
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
    motions: ViewportMotion[],
    pivotTimeMs: number,
    deltaMs: number,
    minZoomDurationMs: number,
    maxZoomDurationMs: number
): ViewportMotion[] => {
    // Clone to avoid mutation
    let nextMotions = [...motions];

    const absDelta = Math.abs(deltaMs);

    if (deltaMs > 0) {
        return nextMotions.map(m => {
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
        const candidates = nextMotions.filter(m => {
            if (m.outputEndTimeMs > deleteRangeStart && m.outputEndTimeMs <= deleteRangeEnd) {
                return false;
            }
            return true;
        });

        const result: ViewportMotion[] = [];
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
