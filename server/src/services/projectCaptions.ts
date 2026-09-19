/**
 * Transcript extraction from project_data for the public watch page
 * (shared-video-get).
 *
 * Caption segments are stored in SOURCE time with cached output times
 * (see the project-model skill: "output times are a cache"). Rather than
 * trust the cache, this rebuilds output times from the project's
 * outputWindows via the shared TimeMapper — the same mapping the editor
 * and render worker use — so the lines line up with the rendered video
 * after cuts and speed changes. Segments that fall entirely inside a cut
 * are dropped, as are hidden words.
 *
 * project_data is the arbitrary editor struct (typed loosely on purpose,
 * as in projectMedia.ts); malformed timelines yield an empty transcript.
 */
import type { SharedVideoCaption } from '@shared/api/projects';
import { TimeMapper, recomputeOutputTimes } from '@shared/mappers/timeMapper';
import type { CaptionSegment, OutputWindow } from '@shared/types/timeline';
import { getSegmentText } from '@shared/utils/captionUtils';

export interface ProjectTimelineShape {
    captionSegments?: unknown;
    outputWindows?: unknown;
}

function isSegment(value: unknown): value is CaptionSegment {
    const s = value as Partial<CaptionSegment> | null;
    return Boolean(s)
        && typeof s!.sourceStartTimeMs === 'number'
        && typeof s!.sourceEndTimeMs === 'number'
        && Array.isArray(s!.words);
}

function isWindow(value: unknown): value is OutputWindow {
    const w = value as Partial<OutputWindow> | null;
    return Boolean(w) && typeof w!.startMs === 'number' && typeof w!.endMs === 'number';
}

/** Output-time transcript lines, sorted; empty when the project has no usable captions. */
export function getOutputCaptions(timeline: ProjectTimelineShape | null | undefined): SharedVideoCaption[] {
    const segments = Array.isArray(timeline?.captionSegments)
        ? timeline.captionSegments.filter(isSegment)
        : [];
    const windows = Array.isArray(timeline?.outputWindows)
        ? timeline.outputWindows.filter(isWindow)
        : [];
    if (segments.length === 0 || windows.length === 0) return [];

    const mapper = new TimeMapper(windows);
    return recomputeOutputTimes(segments, mapper)
        .filter((segment) => segment.visible)
        .map((segment) => ({
            text: getSegmentText(segment, true).trim(),
            startMs: Math.round(segment.outputStartTimeMs),
            endMs: Math.round(segment.outputEndTimeMs),
        }))
        .filter((line) => line.text.length > 0)
        .sort((a, b) => a.startMs - b.startMs);
}
