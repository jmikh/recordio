import type { SourceTimeSegment, ZoomSegment, SpotlightSegment, CaptionSegment } from '../../../types';
import type { TimeMapper } from '../../../core/mappers/timeMapper';

// ============================================================================
// SHARED TIMELINE TRACK UTILITIES
// Generic helpers shared between Spotlight, Zoom, and Caption tracks.
// All time values are in OUTPUT TIME (milliseconds).
// ============================================================================

/**
 * Base interface for any resolved timeline block with output-time positions.
 * id mirrors segment.id for use by shared utility functions.
 */
export interface OutputTimeBlock {
    id: string;
    outputStartTimeMs: number;
    outputEndTimeMs: number;
}

/**
 * A resolved segment: output-time positions + the original typed source segment.
 */
export interface ResolvedSegment<T extends SourceTimeSegment> extends OutputTimeBlock {
    segment: T;
}

// Typed aliases for each track
export type OutputZoomSegment = ResolvedSegment<ZoomSegment>;
export type OutputSpotlightSegment = ResolvedSegment<SpotlightSegment>;
export type OutputCaptionSegment = ResolvedSegment<CaptionSegment>;

// ============================================================================
// RESOLUTION
// ============================================================================

/**
 * Resolves source-time segments to output-time blocks using TimeMapper.
 * Filters out segments that fall entirely within a cut.
 * Works for any SourceTimeSegment (ZoomSegment, SpotlightSegment, CaptionSegment).
 */
export function resolveOutputTimes<T extends SourceTimeSegment>(
    segments: T[],
    timeMapper: TimeMapper
): ResolvedSegment<T>[] {
    const resolved: ResolvedSegment<T>[] = [];
    for (const segment of segments) {
        const range = timeMapper.mapSourceRangeToOutputRange(
            segment.sourceStartTimeMs,
            segment.sourceEndTimeMs
        );
        if (!range) continue;
        resolved.push({
            id: segment.id,
            outputStartTimeMs: range.start,
            outputEndTimeMs: range.end,
            segment,
        });
    }
    return resolved;
}

// ============================================================================
// SOURCE-TIME OVERLAP
// ============================================================================

/**
 * Checks if two source-time ranges overlap.
 */
export function doSourceRangesOverlap(a: SourceTimeSegment, b: SourceTimeSegment): boolean {
    return a.sourceStartTimeMs < b.sourceEndTimeMs && a.sourceEndTimeMs > b.sourceStartTimeMs;
}

// ============================================================================
// OUTPUT-TIME BOUNDS & RANGE HELPERS
// ============================================================================

/**
 * Gets the boundaries for a block (previous block's end and next block's start)
 * in output time. Used for clamping during drag.
 */
export function getBlockBounds(
    blockId: string,
    resolvedBlocks: OutputTimeBlock[],
    outputDuration: number
): { prevEnd: number; nextStart: number } {
    const sorted = [...resolvedBlocks].sort((a, b) => a.outputStartTimeMs - b.outputStartTimeMs);
    const idx = sorted.findIndex(r => r.id === blockId);

    if (idx === -1) {
        return { prevEnd: 0, nextStart: outputDuration };
    }

    const prevEnd = idx > 0 ? sorted[idx - 1].outputEndTimeMs : 0;
    const nextStart = idx < sorted.length - 1 ? sorted[idx + 1].outputStartTimeMs : outputDuration;

    return { prevEnd, nextStart };
}

/**
 * Finds a valid time range for a new block placed at the mouse position.
 *
 * Smart positioning:
 * 1. PREFERRED: Block starts at/near mouse, extends right up to defaultDuration
 * 2. SHRINK: If not enough space for defaultDuration, shrink to fit
 * 3. ANCHOR: If not enough space at mouse, anchor so it ends at the next boundary
 * 4. NULL: Gap is smaller than minDuration — can't place
 */
export function getValidBlockRange(
    mouseTimeMs: number,
    resolvedBlocks: OutputTimeBlock[],
    outputDuration: number,
    minDuration: number,
    defaultDuration: number
): { start: number; end: number } | null {
    const CURSOR_OVERLAP_MS = 100;

    // Find the gap boundaries around the mouse position
    let prevEnd = 0;
    let nextStart = outputDuration;

    for (const r of resolvedBlocks) {
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

    // Anchor: shift left so block ends at nextStart
    const anchoredStart = nextStart - minDuration;
    return { start: Math.max(anchoredStart, prevEnd), end: nextStart };
}
