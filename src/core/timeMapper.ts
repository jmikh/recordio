import type { OutputWindow } from './types';

export class TimeMapper {
    private readonly timelineOffsetMs: number;
    private readonly windows: OutputWindow[];

    constructor(timelineOffsetMs: number, windows: OutputWindow[]) {
        this.timelineOffsetMs = timelineOffsetMs;
        this.windows = windows;
    }

    /**
     * Maps a Timeline Time (which includes gaps) to Output Time (continuous video time).
     * 
     * @param timelineTimeMs The absolute time on the timeline
     * @returns The output time in ms, or -1 if the time is in a gap
     */
    mapTimelineToOutputTime(timelineTimeMs: number): number {
        let outputTimeAccumulator = 0;

        for (const win of this.windows) {
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
    mapOutputToTimelineTime(outputTimeMs: number): number {
        let outputTimeAccumulator = 0;

        for (const win of this.windows) {
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
    mapSourceToOutputTime(sourceTimeMs: number): number {
        // Source Time + Offset = Timeline Time (Un-trimmed)
        // We check if this Timeline Time exists in any window.

        const timelineTime = sourceTimeMs + this.timelineOffsetMs;
        return this.mapTimelineToOutputTime(timelineTime);
    }

    /**
     * Maps an Output Time back to Source Time.
     * Returns -1 if mapped time is invalid.
     */
    mapOutputToSourceTime(outputTimeMs: number): number {
        const timelineTime = this.mapOutputToTimelineTime(outputTimeMs);
        if (timelineTime === -1) return -1;
        return timelineTime - this.timelineOffsetMs;
    }

    /**
     * Gets the total duration of the output video.
     */
    getOutputDuration(): number {
        return this.windows.reduce((acc, win) => acc + (win.endMs - win.startMs), 0);
    }

    /**
     * Maps a source range (start/end) to an output range.
     * Returns the output start and end times.
     * If the start time is not in any window, returns null.
     * The end time is clamped to the end of the window where the start time is found.
     */
    mapSourceRangeToOutputRange(sourceStartMs: number, sourceEndMs: number | undefined): { start: number, end: number } | null {
        const timelineTime = sourceStartMs + this.timelineOffsetMs;
        let acc = 0;
        let startWin: OutputWindow | null = null;
        let startWinAcc = 0;

        // Find start window
        for (const w of this.windows) {
            if (timelineTime >= w.startMs && timelineTime < w.endMs) {
                startWin = w;
                startWinAcc = acc;
                break;
            }
            acc += (w.endMs - w.startMs);
        }

        if (!startWin) return null; // Start is not visible

        const mappedTime = startWinAcc + (timelineTime - startWin.startMs);
        let mappedEndTime = mappedTime;

        if (sourceEndMs !== undefined) {
            const timelineEnd = sourceEndMs + this.timelineOffsetMs;
            // Clamp end time to the end of the current window to ensure validity
            // This handles cases where typing extends into a cut/trim.
            const relevantEnd = Math.min(timelineEnd, startWin.endMs);
            mappedEndTime = startWinAcc + (relevantEnd - startWin.startMs);
        }

        return { start: mappedTime, end: mappedEndTime };
    }
}
