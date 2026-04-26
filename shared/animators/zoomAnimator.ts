import { type ZoomSegment, type Size, type Rect, type ZoomSettings } from '../types';
import { applyEasing } from './easing';

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
    actions: ZoomSegment[],
    outputTimeMs: number,
    outputSize: Size,
    zoomSettings: ZoomSettings
): Rect {
    const fullRect: Rect = { x: 0, y: 0, width: outputSize.width, height: outputSize.height };
    // Global T is used as fallback only if a segment doesn't define its own
    const globalT = zoomSettings.transitionDurationMs;
    const globalEasing = zoomSettings.easing ?? 'ease-in-out';

    // Find the first visible segment
    const firstVisible = actions.find(s => s.visible);
    if (!firstVisible) return fullRect;

    // Before the first block starts
    if (outputTimeMs < firstVisible.outputStartTimeMs) return fullRect;

    // Forward pass: track currentRect as the state at the start of each block
    let currentRect = fullRect;

    for (let i = 0; i < actions.length; i++) {
        const block = actions[i];
        if (!block.visible) continue;

        // Per-segment transition and easing (fall back to global for legacy data)
        const T = block.transitionDurationMs ?? globalT;
        const easing = block.easing ?? globalEasing;

        // Find next visible block
        let nextBlock: ZoomSegment | null = null;
        for (let j = i + 1; j < actions.length; j++) {
            if (actions[j].visible) { nextBlock = actions[j]; break; }
        }

        const blockStart = block.outputStartTimeMs;
        const blockEnd = block.outputEndTimeMs;

        const transitionInEnd = Math.min(blockStart + T, blockEnd);

        // ---- PHASE 1a: Transition IN ----
        if (outputTimeMs >= blockStart && outputTimeMs < transitionInEnd) {
            const elapsed = outputTimeMs - blockStart;
            const t = applyEasing(Math.min(elapsed / T, 1), easing);
            return interpolateRect(currentRect, block.rectPx, t);
        }

        // ---- PHASE 1b: Hold ----
        if (outputTimeMs >= transitionInEnd && outputTimeMs < blockEnd) {
            return block.rectPx;
        }

        // Past this block — compute rect at block end
        const rectAtBlockEnd = (blockEnd - blockStart) >= T
            ? block.rectPx
            : interpolateRect(currentRect, block.rectPx, applyEasing(Math.min((blockEnd - blockStart) / T, 1), easing));

        const gapStart = blockEnd;
        const gapEnd = nextBlock ? nextBlock.outputStartTimeMs : gapStart + T;

        if (outputTimeMs >= gapStart && outputTimeMs < gapEnd) {
            // ---- PHASE 2: Gap zoom-out ----
            const elapsed = outputTimeMs - gapStart;
            const t = applyEasing(Math.min(elapsed / T, 1), easing);
            return interpolateRect(rectAtBlockEnd, fullRect, t);
        }

        if (outputTimeMs >= gapEnd && !nextBlock) {
            return fullRect;
        }

        // Advance currentRect to wherever the gap zoom-out reached at next block start
        if (nextBlock) {
            const gapElapsed = nextBlock.outputStartTimeMs - gapStart;
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
