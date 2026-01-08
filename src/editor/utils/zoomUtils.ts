
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

    // 2. If Auto Zoom is OFF, cleanup invalid/gap zooms
    // We filter out any zooms whose "target time" (sourceEndTimeMs) falls into a gap in the (new) windows.
    // AND we resolve intersections by prioritizing the earlier motion (since sorted)
    // and shrinking/expanding the next one to fit into available space.
    const timeMapper = new TimeMapper(project.timeline.outputWindows);
    const currentMotions = project.timeline.recording.viewportMotions || [];

    const { minZoomDurationMs, maxZoomDurationMs } = project.settings.zoom;

    const validMotions: ViewportMotion[] = [];
    let prevOutputEnd = 0;

    for (const m of currentMotions) {
        // 1. Must exist in valid output time
        const outputTime = timeMapper.mapSourceToOutputTime(m.sourceEndTimeMs);
        if (outputTime === -1) continue;

        // 2. Calculate available space in OUTPUT time
        // This accounts for trims/cuts between the previous zoom and this one.
        const availableSpace = outputTime - prevOutputEnd;

        // 3. If space is less than min duration, we can't fit it -> omit
        if (availableSpace < minZoomDurationMs) continue;

        // 4. Expand to max duration if possible, bounded by available output space
        // Note: durationMs in ViewportMotion is typically Source Duration.
        // But for visual continuity in a trimmed timeline, we ensure it fits in Output Time.
        const newDuration = Math.min(availableSpace, maxZoomDurationMs);

        validMotions.push({
            ...m,
            durationMs: newDuration
        });

        prevOutputEnd = outputTime;
    }

    return validMotions;
};
