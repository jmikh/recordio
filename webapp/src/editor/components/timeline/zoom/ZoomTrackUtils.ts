import type { ZoomAction, Rect, Size } from '../../../../types';

// NOTE: Style constants are now centralized in ZoomTrackStyles.ts

/**
 * Calculate the zoom scale factor from a zoom rect.
 * Scale represents how much the viewport is zoomed in.
 * @returns Scale value (e.g., 2.5 means 2.5x zoom)
 */
export function calculateZoomScale(rect: Rect, outputSize: Size): number {
    // Scale is output width divided by zoom rect width
    const scale = outputSize.width / rect.width;
    return Math.round(scale * 10) / 10; // Round to 1 decimal
}

/**
 * Format scale value for display (e.g., "2.5x", "1x")
 */
export function formatScaleLabel(scale: number): string {
    return `${scale}x`;
}

/**
 * Check if a zoom rect represents full viewport (no zoom).
 * Uses a small tolerance for floating-point comparison.
 */
export function isFullViewport(rect: Rect, outputSize: Size): boolean {
    const tolerance = 1;
    return (
        Math.abs(rect.x) < tolerance &&
        Math.abs(rect.y) < tolerance &&
        Math.abs(rect.width - outputSize.width) < tolerance &&
        Math.abs(rect.height - outputSize.height) < tolerance
    );
}

/**
 * Calculate boundary constraints for a zoom block.
 * Returns the end of the previous block (or 0) and the start of the next block (or timelineEnd).
 * 
 * This scans all other blocks to find the closest ones in either direction.
 */
export function getZoomBlockBounds(
    targetMotionId: string | null,
    actions: ZoomAction[],
    timelineEnd: number
): { prevEnd: number; nextStart: number } {
    // Find the current block position to determine what's "before" and "after"
    const currentAction = targetMotionId
        ? actions.find(m => m.id === targetMotionId)
        : null;

    // If no current action, default to finding closest to start
    const referenceEnd = currentAction?.outputEndTimeMs ?? 0;
    const referenceStart = currentAction
        ? currentAction.outputEndTimeMs - currentAction.durationMs
        : 0;

    let prevEnd = 0;
    let nextStart = timelineEnd;

    for (const m of actions) {
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
