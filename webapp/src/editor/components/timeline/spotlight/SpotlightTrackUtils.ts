import type { SpotlightAction, SpotlightSettings } from '../../../../types';
import type { TimeMapper } from '../../../../core/mappers/timeMapper';

/** Minimum hold portion of a spotlight (ms), excluding fade in/out */
export const K_MIN_SPOTLIGHT_HOLD_MS = 500;

/** Minimum total output duration (ms) for a spotlight to be visible: 2× transition + hold */
export function getMinSpotlightDuration(transitionDurationMs: number): number {
    return 2 * transitionDurationMs + K_MIN_SPOTLIGHT_HOLD_MS;
}

// Default values for backward compatibility with projects that don't have new fields
const DEFAULT_HOLD_MS = 1000;

/**
 * Gets the default total duration for a new spotlight.
 * Total duration = fadeIn + hold + fadeOut
 */
export function getDefaultSpotlightDuration(settings: SpotlightSettings): number {
    const defaultHold = settings.defaultHoldDurationMs ?? DEFAULT_HOLD_MS;
    return settings.transitionDurationMs * 2 + defaultHold;
}

/**
 * Resolved spotlight with computed output times from source times.
 */
export interface ResolvedSpotlight {
    spotlight: SpotlightAction;
    outputStartTimeMs: number;
    outputEndTimeMs: number;
}

/**
 * Resolves spotlight source times to output times using TimeMapper.
 * Filters out spotlights that are entirely trimmed (not in any output window).
 */
export function resolveSpotlightOutputTimes(
    spotlightActions: SpotlightAction[],
    timeMapper: TimeMapper
): ResolvedSpotlight[] {
    const resolved: ResolvedSpotlight[] = [];

    for (const spotlight of spotlightActions) {
        const range = timeMapper.mapSourceRangeToOutputRange(
            spotlight.sourceStartTimeMs,
            spotlight.sourceEndTimeMs
        );
        if (!range) continue; // Spotlight entirely trimmed

        resolved.push({
            spotlight,
            outputStartTimeMs: range.start,
            outputEndTimeMs: range.end
        });
    }

    return resolved;
}

/**
 * Checks if a spotlight would overlap with any existing spotlights (in output time).
 */
export function wouldSpotlightOverlap(
    newStart: number,
    newEnd: number,
    resolvedSpotlights: ResolvedSpotlight[],
    excludeId?: string
): boolean {
    return resolvedSpotlights.some(r => {
        if (excludeId && r.spotlight.id === excludeId) return false;
        return newStart < r.outputEndTimeMs && newEnd > r.outputStartTimeMs;
    });
}

/**
 * Gets the boundaries for a spotlight (previous end and next start) in output time.
 */
export function getSpotlightBounds(
    spotlightId: string,
    resolvedSpotlights: ResolvedSpotlight[],
    outputDuration: number
): { prevEnd: number; nextStart: number } {
    const sorted = [...resolvedSpotlights].sort((a, b) => a.outputStartTimeMs - b.outputStartTimeMs);
    const idx = sorted.findIndex(r => r.spotlight.id === spotlightId);

    if (idx === -1) {
        return { prevEnd: 0, nextStart: outputDuration };
    }

    const prevEnd = idx > 0 ? sorted[idx - 1].outputEndTimeMs : 0;
    const nextStart = idx < sorted.length - 1 ? sorted[idx + 1].outputStartTimeMs : outputDuration;

    return { prevEnd, nextStart };
}

/**
 * Finds valid time range for a new spotlight (in output time).
 * 
 * Smart positioning logic:
 * 1. PREFERRED: Spotlight starts at/near mouse position and extends right
 * 2. FALLBACK: If not enough space to the right, but the gap has enough total space,
 *    anchor the spotlight earlier (shift left) so it fits within the gap
 * 3. HIDE: Only return null if the total gap is smaller than minDuration
 */
export function getValidSpotlightRange(
    mouseTimeMs: number,
    resolvedSpotlights: ResolvedSpotlight[],
    outputDuration: number,
    minDuration: number,
    defaultDuration: number
): { start: number; end: number } | null {
    // Small offset so cursor overlaps with the ghost
    const CURSOR_OVERLAP_MS = 100;

    const sorted = [...resolvedSpotlights].sort((a, b) => a.outputStartTimeMs - b.outputStartTimeMs);

    // Find boundaries around the mouse position (the gap we're in)
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

/**
 * Checks if two source-time ranges overlap.
 */
export function doSourceRangesOverlap(
    a: SpotlightAction,
    b: SpotlightAction
): boolean {
    return a.sourceStartTimeMs < b.sourceEndTimeMs && a.sourceEndTimeMs > b.sourceStartTimeMs;
}
