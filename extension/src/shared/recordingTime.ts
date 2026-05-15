/**
 * @fileoverview Shared recording timer utilities
 *
 * Used by both the popup's RecordingView and the controller's RecordingPhase
 * to display elapsed time correctly, accounting for pauses.
 */

import { useState, useEffect } from 'react';
import type { RecordingState } from './messageTypes';

export function formatTime(ms: number): string {
    const totalSeconds = Math.floor(Math.max(0, ms) / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Tracks elapsed recording time from a RecordingState, pausing the ticker
 * when the recording is paused so the display freezes correctly.
 */
export function useElapsed(state: RecordingState | null): number {
    const [elapsed, setElapsed] = useState(0);

    useEffect(() => {
        if (!state) return;

        const compute = () => {
            const pausedSoFar = (state.totalPausedMs || 0) +
                (state.isPaused && state.pauseStartTime ? Date.now() - state.pauseStartTime : 0);
            return Math.max(0, Date.now() - state.startTime - pausedSoFar);
        };

        setElapsed(compute());
        if (state.isPaused) return; // Don't tick while paused

        const id = setInterval(() => setElapsed(compute()), 1000);
        return () => clearInterval(id);
    }, [state?.startTime, state?.isPaused, state?.totalPausedMs, state?.pauseStartTime]);

    return elapsed;
}
