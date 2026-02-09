import type { CaptionSegment } from '../../../../types';
import type { TimeMapper } from '../../../../core/mappers/timeMapper';

/** Minimum duration (ms) for a caption segment to be visible on the timeline */
export const K_MIN_CAPTION_DURATION_MS = 200;

/** Default duration (ms) for a manually added caption */
export const K_DEFAULT_CAPTION_DURATION_MS = 2000;

// ============= RESOLVED CAPTION =============

/**
 * Resolved caption with computed output times from source times.
 */
export interface ResolvedCaption {
    segment: CaptionSegment;
    outputStartTimeMs: number;
    outputEndTimeMs: number;
}

// ============= RESOLUTION =============

/**
 * Resolves caption source times to output times using TimeMapper.
 * Filters out captions that are entirely trimmed (not in any output window).
 */
export function resolveCaptionOutputTimes(
    segments: CaptionSegment[],
    timeMapper: TimeMapper
): ResolvedCaption[] {
    const resolved: ResolvedCaption[] = [];

    for (const segment of segments) {
        const range = timeMapper.mapSourceRangeToOutputRange(
            segment.sourceStartMs,
            segment.sourceEndMs
        );
        if (!range) continue; // Caption entirely trimmed

        resolved.push({
            segment,
            outputStartTimeMs: range.start,
            outputEndTimeMs: range.end,
        });
    }

    return resolved;
}

// ============= OVERLAP DETECTION =============

/**
 * Checks if a caption would overlap with any existing captions (in output time).
 */
export function wouldCaptionOverlap(
    newStart: number,
    newEnd: number,
    resolvedCaptions: ResolvedCaption[],
    excludeId?: string
): boolean {
    return resolvedCaptions.some(r => {
        if (excludeId && r.segment.id === excludeId) return false;
        return newStart < r.outputEndTimeMs && newEnd > r.outputStartTimeMs;
    });
}

// ============= BOUNDS =============

/**
 * Gets the boundaries for a caption (previous end and next start) in output time.
 */
export function getCaptionBounds(
    captionId: string,
    resolvedCaptions: ResolvedCaption[],
    outputDuration: number
): { prevEnd: number; nextStart: number } {
    const sorted = [...resolvedCaptions].sort((a, b) => a.outputStartTimeMs - b.outputStartTimeMs);
    const idx = sorted.findIndex(r => r.segment.id === captionId);

    if (idx === -1) {
        return { prevEnd: 0, nextStart: outputDuration };
    }

    const prevEnd = idx > 0 ? sorted[idx - 1].outputEndTimeMs : 0;
    const nextStart = idx < sorted.length - 1 ? sorted[idx + 1].outputStartTimeMs : outputDuration;

    return { prevEnd, nextStart };
}

// ============= VALID RANGE FOR NEW CAPTION =============

/**
 * Finds valid time range for a new caption (in output time).
 * Starts at mouse position and extends right, with fallback logic.
 */
export function getValidCaptionRange(
    mouseTimeMs: number,
    resolvedCaptions: ResolvedCaption[],
    outputDuration: number,
    minDuration: number = K_MIN_CAPTION_DURATION_MS,
    defaultDuration: number = K_DEFAULT_CAPTION_DURATION_MS
): { start: number; end: number } | null {
    const CURSOR_OVERLAP_MS = 100;

    const sorted = [...resolvedCaptions].sort((a, b) => a.outputStartTimeMs - b.outputStartTimeMs);

    // Find boundaries around the mouse position
    let prevEnd = 0;
    let nextStart = outputDuration;

    for (const r of sorted) {
        if (r.outputEndTimeMs <= mouseTimeMs) {
            prevEnd = r.outputEndTimeMs;
        }
        if (r.outputStartTimeMs > mouseTimeMs && r.outputStartTimeMs < nextStart) {
            nextStart = r.outputStartTimeMs;
            break;
        }
    }

    const totalGapSize = nextStart - prevEnd;
    if (totalGapSize < minDuration) return null;

    const idealStart = mouseTimeMs - CURSOR_OVERLAP_MS;
    const start = Math.max(idealStart, prevEnd);
    const spaceToRight = nextStart - start;

    if (spaceToRight >= defaultDuration) {
        return { start, end: start + defaultDuration };
    }
    if (spaceToRight >= minDuration) {
        return { start, end: nextStart };
    }

    const anchoredStart = nextStart - minDuration;
    return { start: Math.max(anchoredStart, prevEnd), end: nextStart };
}

// ============= SOURCE RANGE OVERLAP =============

/**
 * Checks if two caption source-time ranges overlap.
 */
export function doCaptionSourceRangesOverlap(
    a: CaptionSegment,
    b: CaptionSegment
): boolean {
    return a.sourceStartMs < b.sourceEndMs && a.sourceEndMs > b.sourceStartMs;
}
