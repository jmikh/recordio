
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

        const timeMapper = new TimeMapper(project.timeline.recording.timelineOffsetMs, project.timeline.outputWindows);

        return calculateZoomSchedule(
            project.settings.zoom.maxZoom,
            project.settings.zoom.defaultDurationMs,
            viewMapper,
            events,
            timeMapper
        );
    }

    // 2. If Auto Zoom is OFF, cleanup invalid/gap zooms
    // We filter out any zooms whose "target time" (sourceEndTimeMs) falls into a gap in the (new) windows.
    const timeMapper = new TimeMapper(project.timeline.recording.timelineOffsetMs, project.timeline.outputWindows);
    const currentMotions = project.timeline.recording.viewportMotions || [];

    return currentMotions.filter(m => {
        const outputTime = timeMapper.mapSourceToOutputTime(m.sourceEndTimeMs);
        return outputTime !== -1;
    });
};
