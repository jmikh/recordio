import type { SourceTimeSegment } from '../../../types';

// ============================================================================
// SHARED TIMELINE TRACK UTILITIES
// Generic helpers shared between Spotlight and Zoom tracks.
// All time values are in OUTPUT TIME (milliseconds).
// ============================================================================

/**
 * Base interface for any resolved timeline segment with output-time positions.
 * Output time is the final rendered time, after cuts and speed adjustments.
 */
export interface OutputTimeBlock {
    id: string;
    outputStartTimeMs: number;
    outputEndTimeMs: number;
}

/**
 * Checks if two source-time ranges overlap.
 */
export function doSourceRangesOverlap(a: SourceTimeSegment, b: SourceTimeSegment): boolean {
    return a.sourceStartTimeMs < b.sourceEndTimeMs && a.sourceEndTimeMs > b.sourceStartTimeMs;
}

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

    const sorted = [...resolvedBlocks].sort((a, b) => a.outputStartTimeMs - b.outputStartTimeMs);

    // Find the gap boundaries around the mouse position
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

    // Anchor: shift left so block ends at nextStart
    const anchoredStart = nextStart - minDuration;
    return { start: Math.max(anchoredStart, prevEnd), end: nextStart };
}
