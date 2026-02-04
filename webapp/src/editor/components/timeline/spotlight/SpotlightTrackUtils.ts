import type { SpotlightAction, SpotlightSettings } from '../../../../types';

// Default values for backward compatibility with projects that don't have new fields
const DEFAULT_MIN_HOLD_MS = 200;
const DEFAULT_HOLD_MS = 1000;

/**
 * Gets the minimum allowed total duration for a spotlight.
 * Total duration = fadeIn + hold + fadeOut
 */
export function getMinSpotlightDuration(settings: SpotlightSettings): number {
    const minHold = settings.minHoldDurationMs ?? DEFAULT_MIN_HOLD_MS;
    return settings.transitionDurationMs * 2 + minHold;
}

/**
 * Gets the default total duration for a new spotlight.
 * Total duration = fadeIn + hold + fadeOut
 */
export function getDefaultSpotlightDuration(settings: SpotlightSettings): number {
    const defaultHold = settings.defaultHoldDurationMs ?? DEFAULT_HOLD_MS;
    return settings.transitionDurationMs * 2 + defaultHold;
}

/**
 * Checks if a spotlight would overlap with any existing spotlights.
 */
export function wouldSpotlightOverlap(
    newStart: number,
    newEnd: number,
    spotlightActions: SpotlightAction[],
    excludeId?: string
): boolean {
    return spotlightActions.some(s => {
        if (excludeId && s.id === excludeId) return false;
        return newStart < s.outputEndTimeMs && newEnd > s.outputStartTimeMs;
    });
}

/**
 * Gets the boundaries for a spotlight (previous end and next start).
 */
export function getSpotlightBounds(
    spotlightId: string,
    spotlightActions: SpotlightAction[],
    outputDuration: number
): { prevEnd: number; nextStart: number } {
    const sorted = [...spotlightActions].sort((a, b) => a.outputStartTimeMs - b.outputStartTimeMs);
    const idx = sorted.findIndex(s => s.id === spotlightId);

    if (idx === -1) {
        return { prevEnd: 0, nextStart: outputDuration };
    }

    const prevEnd = idx > 0 ? sorted[idx - 1].outputEndTimeMs : 0;
    const nextStart = idx < sorted.length - 1 ? sorted[idx + 1].outputStartTimeMs : outputDuration;

    return { prevEnd, nextStart };
}

/**
 * Finds valid time range for a new spotlight.
 * 
 * Smart positioning logic:
 * 1. PREFERRED: Spotlight starts at/near mouse position and extends right
 * 2. FALLBACK: If not enough space to the right, but the gap has enough total space,
 *    anchor the spotlight earlier (shift left) so it fits within the gap
 * 3. HIDE: Only return null if the total gap is smaller than minDuration
 */
export function getValidSpotlightRange(
    mouseTimeMs: number,
    spotlightActions: SpotlightAction[],
    outputDuration: number,
    minDuration: number,
    defaultDuration: number
): { start: number; end: number } | null {
    // Small offset so cursor overlaps with the ghost
    const CURSOR_OVERLAP_MS = 100;

    const sorted = [...spotlightActions].sort((a, b) => a.outputStartTimeMs - b.outputStartTimeMs);

    // Find boundaries around the mouse position (the gap we're in)
    let prevEnd = 0;
    let nextStart = outputDuration;

    for (const s of sorted) {
        if (s.outputEndTimeMs <= mouseTimeMs) {
            prevEnd = s.outputEndTimeMs;
        }
        if (s.outputStartTimeMs > mouseTimeMs && s.outputStartTimeMs < nextStart) {
            nextStart = s.outputStartTimeMs;
            break;
        }
    }

    // Total available space in this gap
    const totalGapSize = nextStart - prevEnd;

    // If the entire gap is smaller than minimum duration, can't add spotlight
    if (totalGapSize < minDuration) {
        return null;
    }

    // Start position (at mouse with small overlap offset, clamped to prevEnd)
    const idealStart = mouseTimeMs - CURSOR_OVERLAP_MS;
    const start = Math.max(idealStart, prevEnd);

    // Space available from start position to next boundary
    const spaceToRight = nextStart - start;

    // PRIORITY 1: Try defaultDuration starting at mouse
    if (spaceToRight >= defaultDuration) {
        return { start, end: start + defaultDuration };
    }

    // PRIORITY 2: Shrink to fit available space (still starting at mouse)
    if (spaceToRight >= minDuration) {
        return { start, end: nextStart };
    }

    // PRIORITY 3: Not enough space at mouse position, anchor with minDuration
    // Position spotlight so it ends at nextStart
    const anchoredStart = nextStart - minDuration;
    return { start: Math.max(anchoredStart, prevEnd), end: nextStart };
}
