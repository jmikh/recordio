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
            // Safety check: zundo v2 uses 'isTracking' (not 'isPaused')
            const temporalState = useProjectStore.temporal.getState() as any;
            if (!temporalState.isTracking) {
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
        const beforeLen = (useProjectStore.temporal.getState() as any).pastStates.length;

        // Execute the action (which should trigger a store update)
        action();

        const afterLen = (useProjectStore.temporal.getState() as any).pastStates.length;
        const historyAdded = afterLen > beforeLen;

        // Only latch (pause tracking) if zundo actually recorded a history entry.
        // This handles the case where the first batchAction doesn't change state
        // (e.g. clicking on a slider thumb at its current position).
        if (interactionCount > 0 && !hasLatched && historyAdded) {
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
