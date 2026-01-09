import type { ViewportMotion } from '../../../../core/types';

/**
 * Calculate boundary constraints for a zoom block.
 * Returns the end of the previous block (or 0) and the start of the next block (or timelineEnd).
 * 
 * This scans all other blocks to find the closest ones in either direction.
 */
export function getZoomBlockBounds(
    targetMotionId: string | null,
    motions: ViewportMotion[],
    timelineEnd: number
): { prevEnd: number; nextStart: number } {
    // Find the current block position to determine what's "before" and "after"
    const currentMotion = targetMotionId
        ? motions.find(m => m.id === targetMotionId)
        : null;

    // If no current motion, default to finding closest to start
    const referenceEnd = currentMotion?.outputEndTimeMs ?? 0;
    const referenceStart = currentMotion
        ? currentMotion.outputEndTimeMs - currentMotion.durationMs
        : 0;

    let prevEnd = 0;
    let nextStart = timelineEnd;

    for (const m of motions) {
        if (m.id === targetMotionId) continue;
        const mEnd = m.outputEndTimeMs;
        const mStart = m.outputEndTimeMs - m.durationMs;

        // A block is "previous" if it's entirely before our current start
        if (mEnd <= referenceStart && mEnd > prevEnd) {
            prevEnd = mEnd;
        }
        // A block is "next" if it starts at or after our current end
        if (mStart >= referenceEnd && mStart < nextStart) {
            nextStart = mStart;
        }
    }

    return { prevEnd, nextStart };
}
