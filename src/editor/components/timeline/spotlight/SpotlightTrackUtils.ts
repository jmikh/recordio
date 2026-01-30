import type { SpotlightAction, SpotlightSettings } from '../../../../core/types';

/**
 * Gets the minimum allowed duration for a spotlight.
 */
export function getMinSpotlightDuration(settings: SpotlightSettings): number {
    return settings.transitionDurationMs * 2 + 100;
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
 * Finds valid time range for a new spotlight at a given click position.
 */
export function getValidSpotlightRange(
    clickTimeMs: number,
    spotlightActions: SpotlightAction[],
    outputDuration: number,
    minDuration: number
): { start: number; end: number } | null {
    const sorted = [...spotlightActions].sort((a, b) => a.outputStartTimeMs - b.outputStartTimeMs);

    let prevEnd = 0;
    let nextStart = outputDuration;

    for (const s of sorted) {
        if (s.outputEndTimeMs <= clickTimeMs) {
            prevEnd = s.outputEndTimeMs;
        }
        if (s.outputStartTimeMs > clickTimeMs && s.outputStartTimeMs < nextStart) {
            nextStart = s.outputStartTimeMs;
            break;
        }
    }

    const availableSpace = nextStart - prevEnd;
    if (availableSpace < minDuration) {
        return null;
    }

    // Default to minimum * 2 or available space
    const defaultDuration = Math.min(minDuration * 2, availableSpace);
    let start = clickTimeMs - defaultDuration / 2;
    let end = clickTimeMs + defaultDuration / 2;

    // Clamp
    if (start < prevEnd) {
        start = prevEnd;
        end = Math.min(start + defaultDuration, nextStart);
    }
    if (end > nextStart) {
        end = nextStart;
        start = Math.max(end - defaultDuration, prevEnd);
    }

    return { start, end };
}
