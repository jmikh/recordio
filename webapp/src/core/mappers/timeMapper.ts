import type { OutputWindow } from '../types';

export class TimeMapper {
    private readonly windows: OutputWindow[];
    public readonly outputDuration: number;

    constructor(windows: OutputWindow[]) {
        this.windows = windows;
        this.outputDuration = this.windows.reduce((acc, win) => {
            const speed = win.speed || 1.0;
            return acc + ((win.endMs - win.startMs) / speed);
        }, 0);
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
                const speed = win.speed || 1.0;
                return outputTimeAccumulator + ((sourceTimeMs - win.startMs) / speed);
            } else if (sourceTimeMs < win.startMs) {
                // Before this window (gap)
                return -1;
            }

            // Passed this window
            const speed = win.speed || 1.0;
            outputTimeAccumulator += (win.endMs - win.startMs) / speed;
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
            const speed = win.speed || 1.0;
            const windowSourceDuration = win.endMs - win.startMs;
            const windowOutputDuration = windowSourceDuration / speed;
            const windowOutputEnd = outputTimeAccumulator + windowOutputDuration;

            if (outputTimeMs < windowOutputEnd) {
                // Output time falls within this window
                const offsetWithinWindow = outputTimeMs - outputTimeAccumulator;
                // Multiply by speed to get source offset
                return win.startMs + (offsetWithinWindow * speed);
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
     * Returns the window containing the given output time, along with its start time in output timeline.
     */
    getWindowAtOutputTime(outputTimeMs: number): { window: OutputWindow, outputStartMs: number } | null {
        if (outputTimeMs < 0) return null;

        let outputTimeAccumulator = 0;

        for (const win of this.windows) {
            const speed = win.speed || 1.0;
            const windowSourceDuration = win.endMs - win.startMs;
            const windowOutputDuration = windowSourceDuration / speed;
            const windowOutputEnd = outputTimeAccumulator + windowOutputDuration;

            // Strict less than for end, greater equal for start (typical hit-test)
            // But for split, we usually want even the exact boundary to belong to the PREVIOUS window 
            // if we are right on the edge? Or NEXT? 
            // Usually cursor is exclusive at end.
            if (outputTimeMs < windowOutputEnd) {
                return { window: win, outputStartMs: outputTimeAccumulator };
            }

            outputTimeAccumulator = windowOutputEnd;
        }

        return null;
    }

    /**
     * Gets the total duration of the output video.
     */
    getOutputDuration(): number {
        return this.outputDuration;
    }

    /**
     * Maps a source range (start/end) to an output range.
     * Returns the output start and end times representing the visible portion of the range.
     * If sourceEndMs is undefined, it is treated as a point event.
     *
     * - If the range is fully visible, returns the corresponding output range.
     * - If the range overlaps with gaps, returns the start of the first visible segment and end of the last visible segment.
     * - If the range is completely hidden (in a gap), returns null.
     */
    mapSourceRangeToOutputRange(sourceStartMs: number, sourceEndMs: number | undefined): { start: number, end: number } | null {
        let acc = 0;
        let startOutput: number | null = null;
        let endOutput: number | null = null;

        // If sourceEndMs is undefined, this is a point event (e.g. click), otherwise it's a range (e.g. scroll).
        const isPoint = sourceEndMs === undefined;
        const effectiveEnd = isPoint ? sourceStartMs : sourceEndMs;

        for (const w of this.windows) {
            const speed = w.speed || 1.0;
            const outputOffset = acc;
            acc += (w.endMs - w.startMs) / speed;

            if (isPoint) {
                // Check if the point falls within the current window [start, end]
                if (sourceStartMs >= w.startMs && sourceStartMs <= w.endMs) {
                    const mapped = outputOffset + ((sourceStartMs - w.startMs) / speed);
                    return { start: mapped, end: mapped };
                }
            } else {
                // Check for overlap between the source range and the current window
                const overlapStart = Math.max(sourceStartMs, w.startMs);
                const overlapEnd = Math.min(effectiveEnd, w.endMs);

                // If valid overlap exists
                if (overlapStart < overlapEnd) {
                    const mappedStart = outputOffset + ((overlapStart - w.startMs) / speed);
                    const mappedEnd = outputOffset + ((overlapEnd - w.startMs) / speed);

                    // Record the first visible start time
                    if (startOutput === null) {
                        startOutput = mappedStart;
                    }
                    // Continually update the end time (extending the visible range through multiple windows)
                    endOutput = mappedEnd;
                }
            }
        }

        if (startOutput !== null && endOutput !== null) {
            return { start: startOutput, end: endOutput };
        }

        return null;
    }
}
