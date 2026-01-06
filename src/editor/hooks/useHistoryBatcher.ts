import { useCallback } from 'react';
import { useProjectStore } from '../stores/useProjectStore';

// Module-level singleton state to support cross-component nesting
// (e.g. ZoomEditor keeps a session open while ZoomTrack performs drag operations)
let interactionCount = 0;
let hasLatched = false;

/**
 * A hook to batch continuous updates into a single history entry using a "Latch" pattern.
 * Uses a global reference counter to handle overlapping or nested interactions.
 */
export const useHistoryBatcher = () => {
    const startInteraction = useCallback(() => {
        if (interactionCount === 0) {
            hasLatched = false;
            // Safety check to ensure we aren't already paused from a stuck state
            const temporalState = useProjectStore.temporal.getState() as any;
            if (temporalState.isPaused) {
                temporalState.resume();
            }
        }
        interactionCount++;
    }, []);

    const endInteraction = useCallback(() => {
        interactionCount--;
        if (interactionCount <= 0) {
            interactionCount = 0; // clamp
            hasLatched = false;
            useProjectStore.temporal.getState().resume();
        }
    }, []);

    const batchAction = useCallback((action: () => void) => {
        // Execute the action (which should trigger a store update)
        action();

        // If we are interacting and haven't latched (paused) yet...
        if (interactionCount > 0 && !hasLatched) {
            // We just made the FIRST update. Zundo should have seen this change or will see it immediately.
            // We pause history now so subsequent updates in this interaction are not recorded.
            useProjectStore.temporal.getState().pause();
            hasLatched = true;
        }
    }, []);

    return {
        startInteraction,
        endInteraction,
        batchAction
    };
};
