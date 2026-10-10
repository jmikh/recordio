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
 * Malformed timelines yield an empty transcript (window parsing lives in
 * projectTimeline.ts).
 */
import type { SharedVideoCaption } from '@shared/api/projects';
import { TimeMapper, recomputeOutputTimes } from '@shared/mappers/timeMapper';
import type { CaptionSegment } from '@shared/types/timeline';
import { getSegmentText } from '@shared/utils/captionUtils';
import { getOutputWindows, type ProjectTimelineShape } from './projectTimeline.js';

function isSegment(value: unknown): value is CaptionSegment {
    const s = value as Partial<CaptionSegment> | null;
    return Boolean(s)
        && typeof s!.sourceStartTimeMs === 'number'
        && typeof s!.sourceEndTimeMs === 'number'
        && Array.isArray(s!.words);
}

/** Output-time transcript lines, sorted; empty when the project has no usable captions. */
export function getOutputCaptions(timeline: ProjectTimelineShape | null | undefined): SharedVideoCaption[] {
    const segments = Array.isArray(timeline?.captionSegments)
        ? timeline.captionSegments.filter(isSegment)
        : [];
    const windows = getOutputWindows(timeline);
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
