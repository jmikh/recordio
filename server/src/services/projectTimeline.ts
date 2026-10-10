/**
 * Reading the timeline out of project_data on the server — the shape the
 * routes select (only the jsonb paths they need, never the whole
 * project_data) and the output-time facts derived from it via the shared
 * TimeMapper, the same mapping the editor and render worker use.
 *
 * project_data is the arbitrary editor struct (typed loosely on purpose,
 * as in projectMedia.ts); malformed values are filtered out rather than
 * trusted.
 */
import { TimeMapper } from '@shared/mappers/timeMapper';
import type { OutputWindow } from '@shared/types/timeline';

/** The timeline paths a route selects; each is whatever the jsonb holds */
export interface ProjectTimelineShape {
    captionSegments?: unknown;
    outputWindows?: unknown;
}

function isWindow(value: unknown): value is OutputWindow {
    const w = value as Partial<OutputWindow> | null;
    return Boolean(w) && typeof w!.startMs === 'number' && typeof w!.endMs === 'number';
}

/** The well-formed output windows; empty when there are none */
export function getOutputWindows(timeline: ProjectTimelineShape | null | undefined): OutputWindow[] {
    return Array.isArray(timeline?.outputWindows)
        ? timeline.outputWindows.filter(isWindow)
        : [];
}

/**
 * The rendered video's length from the live timeline (cuts and speed
 * applied); undefined when the timeline has no usable windows. Edits made
 * after publishing aren't in the rendered video yet, so this can drift
 * from it — the same accepted drift as the watch page's transcript.
 */
export function getOutputDurationMs(timeline: ProjectTimelineShape | null | undefined): number | undefined {
    const windows = getOutputWindows(timeline);
    if (windows.length === 0) return undefined;
    return Math.round(new TimeMapper(windows).getOutputDuration());
}
