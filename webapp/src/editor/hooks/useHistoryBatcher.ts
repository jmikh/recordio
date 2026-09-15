import { useProjectStore } from '../stores/useProjectStore';

/** The slice of a zundo temporal store the batcher drives. */
interface TemporalApi {
    getState: () => {
        isTracking: boolean;
        pastStates: unknown[];
        pause: () => void;
        resume: () => void;
    };
}

export interface HistoryBatcher {
    startInteraction: () => void;
    endInteraction: () => void;
    batchAction: (action: () => void) => void;
}

/**
 * Builds a history batcher bound to one temporal store. The batcher
 * collapses continuous updates into a single history entry using a
 * "latch" pattern, with a per-store reference counter so overlapping or
 * nested interactions (e.g. ZoomEditor keeps a session open while
 * ZoomTrack performs drag operations) share one entry.
 *
 * Returns a hook-shaped accessor: the batcher's functions are stable, so
 * they're safe in dependency arrays. The video editor's is below; the
 * screenshot editor (plans/screenshots) creates its own over its store.
 */
export function createHistoryBatcher(getTemporal: () => TemporalApi): () => HistoryBatcher {
    let interactionCount = 0;
    let hasLatched = false;

    const startInteraction = () => {
        if (interactionCount === 0) {
            hasLatched = false;
            // Safety check: zundo v2 uses 'isTracking' (not 'isPaused')
            const temporalState = getTemporal().getState();
            if (!temporalState.isTracking) {
                temporalState.resume();
            }
        }
        interactionCount++;
    };

    const endInteraction = () => {
        interactionCount--;
        if (interactionCount <= 0) {
            interactionCount = 0; // clamp
            hasLatched = false;
            getTemporal().getState().resume();
        }
    };

    const batchAction = (action: () => void) => {
        const beforeLen = getTemporal().getState().pastStates.length;

        // Execute the action (which should trigger a store update)
        action();

        const afterLen = getTemporal().getState().pastStates.length;
        const historyAdded = afterLen > beforeLen;

        // Only latch (pause tracking) if zundo actually recorded a history entry.
        // This handles the case where the first batchAction doesn't change state
        // (e.g. clicking on a slider thumb at its current position).
        if (interactionCount > 0 && !hasLatched && historyAdded) {
            getTemporal().getState().pause();
            hasLatched = true;
        }
    };

    const batcher: HistoryBatcher = { startInteraction, endInteraction, batchAction };
    return () => batcher;
}

/**
 * A hook to batch continuous project updates into a single history entry.
 * Module-level singleton state (inside the factory closure) supports
 * cross-component nesting.
 */
export const useHistoryBatcher = createHistoryBatcher(() => useProjectStore.temporal);
