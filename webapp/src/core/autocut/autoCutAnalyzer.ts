/**
 * AutoCut Analyzer
 * 
 * Analyzes speech segments (from VAD) and user events to find segments to keep,
 * removing silent/inactive gaps from the timeline.
 */

import type { UserEvents, BaseEvent } from '@shared/types';
import type { OutputWindow } from '../../types';
import type { SpeechSegment } from './vadService';

// ============================================================================
// Event Activity Analysis
// ============================================================================

/**
 * Extract active time ranges from user events.
 * Uses timestamp and endTime for range events.
 */
function getEventActiveRanges(
    userEvents: UserEvents,
    totalDurationMs: number
): Array<{ startMs: number; endMs: number }> {
    const ranges: Array<{ startMs: number; endMs: number }> = [];

    // Helper to add event as range
    const bufferMs = 250;
    const addEvent = (event: BaseEvent) => {
        const start = Math.max(0, event.timestamp - bufferMs);
        const end = Math.min((event.endTime ?? event.timestamp) + bufferMs, totalDurationMs);
        ranges.push({ startMs: start, endMs: end });
    };

    // Process all event types
    userEvents.mouseClicks.forEach(addEvent);
    userEvents.typingEvents.forEach(addEvent);
    userEvents.drags.forEach(addEvent);
    userEvents.scrolls.forEach(addEvent);
    userEvents.keyboardEvents.forEach(addEvent);

    // Mouse positions - group nearby positions into ranges
    if (userEvents.mousePositions.length > 0) {
        let rangeStart = userEvents.mousePositions[0].timestamp;
        let lastTime = rangeStart;

        for (const pos of userEvents.mousePositions) {
            // If gap > 500ms, close current range and start new one
            if (pos.timestamp - lastTime > 500) {
                ranges.push({ startMs: rangeStart, endMs: lastTime });
                rangeStart = pos.timestamp;
            }
            lastTime = pos.timestamp;
        }

        // Close final range
        ranges.push({ startMs: rangeStart, endMs: lastTime });
    }

    return ranges;
}

// ============================================================================
// Segment Merging
// ============================================================================

/**
 * Merge overlapping time ranges into non-overlapping segments.
 */
function mergeRanges(
    ranges: Array<{ startMs: number; endMs: number }>
): Array<{ startMs: number; endMs: number }> {
    if (ranges.length === 0) return [];

    // Sort by start time
    const sorted = [...ranges].sort((a, b) => a.startMs - b.startMs);

    const merged: Array<{ startMs: number; endMs: number }> = [];
    let current = { ...sorted[0] };

    for (let i = 1; i < sorted.length; i++) {
        const next = sorted[i];

        if (next.startMs <= current.endMs) {
            // Overlap - extend current
            current.endMs = Math.max(current.endMs, next.endMs);
        } else {
            // No overlap - push current and start new
            merged.push(current);
            current = { ...next };
        }
    }

    merged.push(current);
    return merged;
}

// ============================================================================
// Main AutoCut Analysis
// ============================================================================

export interface AutoCutResult {
    windows: OutputWindow[];
    totalRemovedMs: number;
}

/**
 * Analyze speech segments and events to derive output windows,
 * removing silent/inactive gaps from the timeline.
 *
 * @param speechSegments Speech segments detected by VAD (or empty if no audio)
 * @param userEvents User interaction events
 * @param totalDurationMs Total source video duration
 * @param currentWindows Existing output windows to respect — autocut will never
 *                       re-add source time that is not already included in these windows.
 *                       If omitted, operates on the full source duration.
 * @returns New output windows and total milliseconds removed
 */
export function analyzeForAutoCut(
    speechSegments: SpeechSegment[],
    userEvents: UserEvents,
    totalDurationMs: number,
    currentWindows?: OutputWindow[]
): AutoCutResult {
    // 1. Get activity ranges from events
    const eventRanges = getEventActiveRanges(userEvents, totalDurationMs);

    // 2. Convert speech segments to range format
    const speechRanges = speechSegments.map(seg => ({
        startMs: seg.startMs,
        endMs: seg.endMs
    }));

    // 3. Merge all active ranges
    const allActiveRanges = mergeRanges([...eventRanges, ...speechRanges]);

    // 4. If no activity detected, return single window spanning entire video
    if (allActiveRanges.length === 0) {
        return {
            windows: [{
                id: crypto.randomUUID(),
                startMs: 0,
                endMs: totalDurationMs,
                speed: 1.0
            }],
            totalRemovedMs: 0
        };
    }

    // 5. Apply minimum gap threshold - only cut if gap >= 500ms
    const MIN_GAP_MS = 500;
    const filteredRanges: Array<{ startMs: number; endMs: number }> = [];

    if (allActiveRanges.length > 0) {
        let current = { ...allActiveRanges[0] };

        for (let i = 1; i < allActiveRanges.length; i++) {
            const next = allActiveRanges[i];
            const gapMs = next.startMs - current.endMs;

            if (gapMs >= MIN_GAP_MS) {
                // Gap is large enough - keep as separate segments
                filteredRanges.push(current);
                current = { ...next };
            } else {
                // Gap is too small - bridge it by extending current range
                current.endMs = next.endMs;
            }
        }

        filteredRanges.push(current);
    }

    // 6. Intersect with existing output windows so we never re-add cut source time
    let finalRanges = filteredRanges;
    if (currentWindows && currentWindows.length > 0) {
        const sortedCurrent = [...currentWindows].sort((a, b) => a.startMs - b.startMs);
        const intersected: Array<{ startMs: number; endMs: number }> = [];

        for (const range of filteredRanges) {
            for (const win of sortedCurrent) {
                const start = Math.max(range.startMs, win.startMs);
                const end = Math.min(range.endMs, win.endMs);
                if (start < end) {
                    intersected.push({ startMs: start, endMs: end });
                }
            }
        }

        finalRanges = mergeRanges(intersected);
    }

    // 7. Convert to OutputWindows
    const windows: OutputWindow[] = finalRanges.map(seg => ({
        id: crypto.randomUUID(),
        startMs: seg.startMs,
        endMs: seg.endMs,
        speed: 1.0
    }));

    // 8. Calculate total removed time
    const keptDuration = finalRanges.reduce(
        (acc, seg) => acc + (seg.endMs - seg.startMs),
        0
    );
    const totalRemovedMs = totalDurationMs - keptDuration;

    return { windows, totalRemovedMs };
}
