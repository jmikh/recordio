import { type ZoomAction, type Size, type Rect, type ZoomSettings } from '../../types';
import { TimeMapper } from '../mappers/timeMapper';
import { applyEasing } from '../easing';

// ============================================================================
// Prepared Zoom Action
// ============================================================================

/**
 * Prepared zoom action with computed output times and duration.
 * Used for viewport interpolation and UI rendering.
 */
export interface PreparedZoomAction extends ZoomAction {
    outputStartTime: number;
    outputEndTime: number;
    duration: number;
}

// ============================================================================
// Preparation / Resolution
// ============================================================================

/**
 * Prepares zoom actions for interpolation by converting source times to output times.
 * Filters out invisible zooms (those that map outside the output range).
 * Input is assumed to be pre-sorted by source time; output is sorted by output start time.
 */
export function prepareZoomActionsForInterpolation(
    actions: ZoomAction[],
    timeMapper: TimeMapper,
    zoomSettings: ZoomSettings
): PreparedZoomAction[] {
    return actions
        .map(action => {
            const outputStartTime = timeMapper.mapSourceToOutputTime(action.sourceStartTimeMs);
            let outputEndTime = timeMapper.mapSourceToOutputTime(action.sourceEndTimeMs);
            // If end time is past the last window, clamp to output duration
            if (outputEndTime === -1 && outputStartTime !== -1) {
                outputEndTime = timeMapper.outputDuration;
            }
            return { action, outputStartTime, outputEndTime };
        })
        .filter(({ outputStartTime, outputEndTime }) =>
            outputStartTime !== -1 && outputEndTime !== -1
        )
        .map(({ action, outputStartTime, outputEndTime }) => ({
            ...action,
            outputStartTime,
            outputEndTime,
            duration: outputEndTime - outputStartTime,
        }));
}

// ============================================================================
// Viewport Interpolation
// ============================================================================

/**
 * Calculates the exact viewport state at a given output time using continuous interpolation.
 *
 * **Model:**
 * - Before the first block: full viewport
 * - During a block's transition-in [blockStart, blockStart + T]: ease from currentRect → rectPx
 * - During a block's hold [blockStart + T, blockEnd]: hold at rectPx
 * - In a gap after a block [blockEnd, nextBlockStart]: ease from rectPx → fullRect over T
 *   (may not complete if the gap is shorter than T)
 * - When the next block starts, it eases from wherever the gap zoom-out reached
 * - After the last block: ease from rectPx → fullRect over T
 *
 * The key property: `currentRect` at the start of each block is the actual
 * interpolated state at that moment — never a jump.
 *
 * @param actions - Zoom actions (pre-sorted by source time)
 * @param outputTimeMs - Output time to calculate viewport for
 * @param outputSize - Output video size
 * @param timeMapper - TimeMapper for source to output time conversion
 * @param zoomSettings - Zoom settings (transitionDurationMs, easing)
 */
export function getViewportStateAtTime(
    actions: ZoomAction[],
    outputTimeMs: number,
    outputSize: Size,
    timeMapper: TimeMapper,
    zoomSettings: ZoomSettings
): Rect {
    const fullRect: Rect = { x: 0, y: 0, width: outputSize.width, height: outputSize.height };
    const T = zoomSettings.transitionDurationMs;
    const easing = zoomSettings.easing ?? 'ease-in-out';

    const prepared = prepareZoomActionsForInterpolation(actions, timeMapper, zoomSettings);

    if (prepared.length === 0) return fullRect;

    // Before the first block starts
    if (outputTimeMs < prepared[0].outputStartTime) return fullRect;

    // Forward pass: track currentRect as the state at the start of each block
    // (i.e. wherever the previous gap zoom-out reached by the time this block begins)
    let currentRect = fullRect;

    for (let i = 0; i < prepared.length; i++) {
        const block = prepared[i];
        const nextBlock = prepared[i + 1] ?? null;

        // Clamp transition-in end to the block's own end time.
        // If the block is shorter than T, the zoom-in never fully completes —
        // it just reaches wherever it gets to by outputEndTime.
        const transitionInEnd = Math.min(block.outputStartTime + T, block.outputEndTime);

        // ---- PHASE 1a: Transition IN ----
        if (outputTimeMs >= block.outputStartTime && outputTimeMs < transitionInEnd) {
            const elapsed = outputTimeMs - block.outputStartTime;
            const t = applyEasing(Math.min(elapsed / T, 1), easing);
            return interpolateRect(currentRect, block.rectPx, t);
        }

        // ---- PHASE 1b: Hold ----
        // Only exists if the block is longer than T
        if (outputTimeMs >= transitionInEnd && outputTimeMs < block.outputEndTime) {
            return block.rectPx;
        }

        // We're past this block — compute the rect at block end
        // (may be partially zoomed-in if block was shorter than T)
        const rectAtBlockEnd = (block.outputEndTime - block.outputStartTime) >= T
            ? block.rectPx
            : interpolateRect(currentRect, block.rectPx, applyEasing(Math.min((block.outputEndTime - block.outputStartTime) / T, 1), easing));

        const gapStart = block.outputEndTime;
        const gapEnd = nextBlock ? nextBlock.outputStartTime : gapStart + T;

        if (outputTimeMs >= gapStart && outputTimeMs < gapEnd) {
            // ---- PHASE 2: Gap zoom-out ----
            const elapsed = outputTimeMs - gapStart;
            const t = applyEasing(Math.min(elapsed / T, 1), easing);
            return interpolateRect(rectAtBlockEnd, fullRect, t);
        }

        if (outputTimeMs >= gapEnd && !nextBlock) {
            // ---- After last block, gap complete ----
            return fullRect;
        }

        // Advance currentRect to wherever the gap zoom-out reached at nextBlock.outputStartTime
        if (nextBlock) {
            const gapElapsed = nextBlock.outputStartTime - gapStart;
            const t = applyEasing(Math.min(gapElapsed / T, 1), easing);
            currentRect = interpolateRect(rectAtBlockEnd, fullRect, t);
        }
    }

    return currentRect;
}

// ============================================================================
// Utilities
// ============================================================================

export function interpolateRect(from: Rect, to: Rect, t: number): Rect {
    return {
        x: from.x + (to.x - from.x) * t,
        y: from.y + (to.y - from.y) * t,
        width: from.width + (to.width - from.width) * t,
        height: from.height + (to.height - from.height) * t,
    };
}
