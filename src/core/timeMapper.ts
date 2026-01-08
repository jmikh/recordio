import type { OutputWindow } from './types';

export class TimeMapper {
    private readonly windows: OutputWindow[];

    constructor(windows: OutputWindow[]) {
        this.windows = windows;
    }



    /**
     * Converts a Source Time (e.g. raw recording timestamp) to Output Time.
     * Note: A single Source Time might appear multiple times if clips are duplicated, 
     * or not at all if trimmed. This function returns the FIRST occurrence or -1.
     */
    mapSourceToOutputTime(sourceTimeMs: number): number {
        // Source Time = Output Time (Since offset is always 0)
        // We check if this Output Time exists in any window.
        let outputTimeAccumulator = 0;

        for (const win of this.windows) {
            if (sourceTimeMs >= win.startMs && sourceTimeMs <= win.endMs) {
                // Inside this window
                return outputTimeAccumulator + (sourceTimeMs - win.startMs);
            } else if (sourceTimeMs < win.startMs) {
                // Before this window (gap)
                return -1;
            }

            // Passed this window
            outputTimeAccumulator += (win.endMs - win.startMs);
        }

        return -1; // End of timeline or gap
    }

    /**
     * Maps an Output Time back to Source Time.
     * Walks through windows to find which window contains the output time,
     * then calculates the corresponding source time.
     */
    mapOutputToSourceTime(outputTimeMs: number): number {
        if (outputTimeMs < 0) return -1;

        let outputTimeAccumulator = 0;

        for (const win of this.windows) {
            const windowDuration = win.endMs - win.startMs;
            const windowOutputEnd = outputTimeAccumulator + windowDuration;

            if (outputTimeMs < windowOutputEnd) {
                // Output time falls within this window
                const offsetWithinWindow = outputTimeMs - outputTimeAccumulator;
                return win.startMs + offsetWithinWindow;
            }

            outputTimeAccumulator = windowOutputEnd;
        }

        // Handle exact end of last window (inclusive end)
        if (outputTimeMs === outputTimeAccumulator && this.windows.length > 0) {
            const lastWindow = this.windows[this.windows.length - 1];
            return lastWindow.endMs;
        }

        return -1; // Past end of all windows
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
        let acc = 0;
        let startWin: OutputWindow | null = null;
        let startWinAcc = 0;

        // Find start window
        for (const w of this.windows) {
            if (sourceStartMs >= w.startMs && sourceStartMs < w.endMs) {
                startWin = w;
                startWinAcc = acc;
                break;
            }
            acc += (w.endMs - w.startMs);
        }

        if (!startWin) return null; // Start is not visible

        const mappedTime = startWinAcc + (sourceStartMs - startWin.startMs);
        let mappedEndTime = mappedTime;

        if (sourceEndMs !== undefined) {
            // Clamp end time to the end of the current window to ensure validity
            // This handles cases where typing extends into a cut/trim.
            const relevantEnd = Math.min(sourceEndMs, startWin.endMs);
            mappedEndTime = startWinAcc + (relevantEnd - startWin.startMs);
        }

        return { start: mappedTime, end: mappedEndTime };
    }
}
