import type { OutputWindow } from '../types';

/**
 * Maps a Timeline Time (which includes gaps) to Output Time (continuous video time).
 * 
 * @param timelineTimeMs The absolute time on the timeline
 * @param windows Sorted list of output windows
 * @returns The output time in ms, or -1 if the time is in a gap
 */
export function mapTimelineToOutputTime(timelineTimeMs: number, windows: OutputWindow[]): number {
    let outputTimeAccumulator = 0;

    for (const win of windows) {
        if (timelineTimeMs >= win.startMs && timelineTimeMs < win.endMs) {
            // Inside this window
            return outputTimeAccumulator + (timelineTimeMs - win.startMs);
        } else if (timelineTimeMs < win.startMs) {
            // Before this window (gap)
            // return -1 to indicate "not visible".
            return -1;
        }

        // Passed this window
        outputTimeAccumulator += (win.endMs - win.startMs);
    }

    return -1; // End of timeline or gap
}

/**
 * Maps an Output Time back to Timeline Time.
 * Useful for finding where a specific frame in the final video comes from.
 */
export function mapOutputToTimelineTime(outputTimeMs: number, windows: OutputWindow[]): number {
    let outputTimeAccumulator = 0;

    for (const win of windows) {
        const winDuration = win.endMs - win.startMs;
        if (outputTimeMs < outputTimeAccumulator + winDuration) {
            const offsetInWindow = outputTimeMs - outputTimeAccumulator;
            return win.startMs + offsetInWindow;
        }
        outputTimeAccumulator += winDuration;
    }

    return -1; // Out of bounds
}

/**
 * Converts a Source Time (e.g. raw recording timestamp) to Output Time.
 * Note: A single Source Time might appear multiple times if clips are duplicated, 
 * or not at all if trimmed. This function returns the FIRST occurrence or -1.
 */
export function mapSourceToOutputTime(
    sourceTimeMs: number,
    windows: OutputWindow[],
    timelineOffsetMs: number
): number {
    // Source Time + Offset = Timeline Time (Un-trimmed)
    // We check if this Timeline Time exists in any window.

    const timelineTime = sourceTimeMs + timelineOffsetMs;
    return mapTimelineToOutputTime(timelineTime, windows);
}

/**
 * Maps an Output Time back to Source Time.
 * Returns -1 if mapped time is invalid.
 */
export function mapOutputToSourceTime(
    outputTimeMs: number,
    windows: OutputWindow[],
    timelineOffsetMs: number
): number {
    const timelineTime = mapOutputToTimelineTime(outputTimeMs, windows);
    if (timelineTime === -1) return -1;
    return timelineTime - timelineOffsetMs;
}

/**
 * Gets the total duration of the output video.
 */
export function getOutputDuration(windows: OutputWindow[]): number {
    return windows.reduce((acc, win) => acc + (win.endMs - win.startMs), 0);
}
