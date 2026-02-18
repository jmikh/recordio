import type { ZoomSegment } from '../../../../types';
import type { TimeMapper } from '../../../../core/mappers/timeMapper';
import { doSourceRangesOverlap, getBlockBounds, getValidBlockRange } from '../timelineTrackUtils';
import type { OutputTimeBlock } from '../timelineTrackUtils';

// ============================================================================
// CONSTANTS
// ============================================================================

/** Minimum hold portion of a zoom block (ms), excluding transition-in */
export const K_MIN_ZOOM_HOLD_MS = 100;

/** Default hold duration for a newly placed zoom block */
const DEFAULT_HOLD_MS = 3000;

// ============================================================================
// TYPES
// ============================================================================

/**
 * Zoom segment with resolved output times, ready for UI rendering.
 */
export interface ResolvedZoomSegment extends OutputTimeBlock {
    zoomSegment: ZoomSegment;
}

// ============================================================================
// DURATION HELPERS
// ============================================================================

/**
 * Minimum total output duration for a zoom block to be visible:
 * transition-in + minimum hold.
 */
export function getMinZoomDuration(transitionDurationMs: number): number {
    return transitionDurationMs + K_MIN_ZOOM_HOLD_MS;
}

/**
 * Default total duration for a newly placed zoom block:
 * transition-in + default hold (capped at 3s total).
 */
export function getDefaultZoomDuration(transitionDurationMs: number): number {
    return transitionDurationMs + DEFAULT_HOLD_MS;
}

// ============================================================================
// RESOLUTION
// ============================================================================

/**
 * Resolves zoom segment source times to output times using TimeMapper.
 * Filters out segments entirely in a cut.
 */
export function resolveZoomOutputTimes(
    zoomSegments: ZoomSegment[],
    timeMapper: TimeMapper
): ResolvedZoomSegment[] {
    const resolved: ResolvedZoomSegment[] = [];

    for (const segment of zoomSegments) {
        const range = timeMapper.mapSourceRangeToOutputRange(
            segment.sourceStartTimeMs,
            segment.sourceEndTimeMs
        );
        if (!range) continue;

        resolved.push({
            id: segment.id,
            zoomSegment: segment,
            outputStartTimeMs: range.start,
            outputEndTimeMs: range.end,
        });
    }

    return resolved;
}

// ============================================================================
// BOUNDS & RANGE HELPERS (re-exported from shared utils with zoom-specific names)
// ============================================================================

export { doSourceRangesOverlap, getBlockBounds, getValidBlockRange };
