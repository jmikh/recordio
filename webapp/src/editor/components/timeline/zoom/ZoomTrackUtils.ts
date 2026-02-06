import type { ZoomAction, Rect, Size, ZoomSettings } from '../../../../types';
import type { TimeMapper } from '../../../../core/mappers/timeMapper';
import { prepareZoomActionsForInterpolation } from '../../../../core/zoom';

// NOTE: Style constants are now centralized in ZoomTrackStyles.ts

/**
 * Prepared zoom action with computed output times and duration for UI rendering.
 */
export interface PreparedZoomAction extends ZoomAction {
    outputEndTime: number;
    outputStartTime: number;
    duration: number;
}

/**
 * Prepares zoom actions for UI rendering by converting source times to output times.
 */
export function prepareZoomActionsForUI(
    actions: ZoomAction[],
    timeMapper: TimeMapper,
    zoomSettings: ZoomSettings
): PreparedZoomAction[] {
    return prepareZoomActionsForInterpolation(actions, timeMapper, zoomSettings) as PreparedZoomAction[];
}

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
 * Calculate boundary constraints for a zoom block using prepared actions.
 * Returns the end of the previous block (or 0) and the start of the next block (or timelineEnd).
 * 
 * This scans all other blocks to find the closest ones in either direction.
 */
export function getZoomBlockBounds(
    targetMotionId: string | null,
    preparedActions: PreparedZoomAction[],
    timelineEnd: number
): { prevEnd: number; nextEnd: number } {
    // Find the current block position to determine what's "before" and "after"
    const currentAction = targetMotionId
        ? preparedActions.find(m => m.id === targetMotionId)
        : null;

    // If no current action, default to finding closest to start
    const referenceEnd = currentAction?.outputEndTime ?? 0;
    const referenceStart = currentAction?.outputStartTime ?? 0;

    let prevEnd = 0;
    let nextEnd = timelineEnd;

    for (const m of preparedActions) {
        if (m.id === targetMotionId) continue;
        const mEnd = m.outputEndTime;

        // A block is "previous" if it ends before our current start
        if (mEnd <= referenceStart && mEnd > prevEnd) {
            prevEnd = mEnd;
        }
        // A block is "next" if it ends after our current end (find the closest one)
        if (mEnd > referenceEnd && mEnd < nextEnd) {
            nextEnd = mEnd;
        }
    }

    return { prevEnd, nextEnd };
}
