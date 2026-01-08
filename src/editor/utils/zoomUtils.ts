
import type { ID, Project, UserEvents, ViewportMotion } from '../../core/types';
import { calculateZoomSchedule, ViewMapper } from '../../core/viewportMotion';
import { TimeMapper } from '../../core/timeMapper';


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
        const screenSourceId = project.timeline.recording.screenSourceId;
        const sourceMetadata = sources[screenSourceId];

        if (!sourceMetadata) {
            console.warn("Skipping zoom recalc: Missing source or events", screenSourceId);
            return project.timeline.recording.viewportMotions;
        }

        const viewMapper = new ViewMapper(
            sourceMetadata.size,
            project.settings.outputSize,
            project.settings.screen.padding,
            project.settings.screen.crop
        );

        const timeMapper = new TimeMapper(project.timeline.outputWindows);

        return calculateZoomSchedule(
            project.settings.zoom,
            viewMapper,
            events,
            timeMapper
        );
    }

    return project.timeline.recording.viewportMotions;
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
    deltaMs: number
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
        // Removing time
        const deleteRangeStart = pivotTimeMs;
        const deleteRangeEnd = pivotTimeMs + absDelta;

        return nextMotions.filter(m => {
            // Drop if it falls in the deleted range
            if (m.outputEndTimeMs > deleteRangeStart && m.outputEndTimeMs <= deleteRangeEnd) {
                return false;
            }
            return true;
        }).map(m => {
            // Shift items that were after the deleted range
            if (m.outputEndTimeMs > deleteRangeEnd) {
                return {
                    ...m,
                    outputEndTimeMs: m.outputEndTimeMs - absDelta
                };
            }
            return m;
        });
    }
};
