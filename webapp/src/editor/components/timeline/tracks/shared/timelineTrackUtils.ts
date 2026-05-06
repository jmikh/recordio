import type { TimeSegment, ZoomSegment, SpotlightSegment, CaptionSegment } from '@shared/types';

// ============================================================================
// SHARED TIMELINE TRACK UTILITIES
// Generic helpers shared between Spotlight, Zoom, and Caption tracks.
// All time values are in OUTPUT TIME (milliseconds).
// ============================================================================

// Typed aliases for each track — segments now carry output times directly
export type OutputZoomSegment = ZoomSegment;
export type OutputSpotlightSegment = SpotlightSegment;
export type OutputCaptionSegment = CaptionSegment;

// ============================================================================
// SOURCE-TIME OVERLAP
// ============================================================================

/**
 * Checks if two source-time ranges overlap.
 */
export function doSourceRangesOverlap(a: TimeSegment, b: TimeSegment): boolean {
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
    segments: TimeSegment[],
    outputDuration: number
): { prevEnd: number; nextStart: number } {
    const sorted = [...segments]
        .filter(s => s.visible)
    const idx = sorted.findIndex(s => s.id === blockId);

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
    segments: TimeSegment[],
    outputDuration: number,
    minDuration: number,
    defaultDuration: number
): { start: number; end: number } | null {
    const CURSOR_OVERLAP_MS = 100;

    // Find the gap boundaries around the mouse position
    let prevEnd = 0;
    let nextStart = outputDuration;

    for (const s of segments) {
        if (!s.visible) continue;
        if (s.outputEndTimeMs <= mouseTimeMs) {
            prevEnd = s.outputEndTimeMs;
        }
        if (s.outputStartTimeMs > mouseTimeMs && s.outputStartTimeMs < nextStart) {
            nextStart = s.outputStartTimeMs;
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
