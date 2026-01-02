import { useRef, useCallback } from 'react';
import { useProjectStore, useProjectData } from '../stores/useProjectStore';

/**
 * useHistoryBatcher
 * 
 * A hook to optimize undo/redo behavior for continuous interactions (like dragging sliders or color pickers).
 * 
 * Problem:
 * Continuous updates (e.g., dragging a slider from 0 to 100) flood the history stack with intermediate states.
 * If we simply pause history at the start, we miss capturing the *initial* state (0), so undoing would skip it.
 * 
 * Strategy ("The Latch"):
 * 1. `startInteraction`: Marks the start of an interaction but does NOT pause yet.
 * 2. First `updateWithBatching`: Allows the update to go through to the store. This forces `zundo` to snapshot
 *    the *previous* state (the state before drag started) into the history stack.
 *    IMMEDIATELY after this first update, we pause the history.
 * 3. Subsequent updates: History is paused, so intermediate values are ignored.
 * 4. `endInteraction`: Resumes history tracking.
 * 
 * Result:
 * The history stack contains [State Before Drag] -> [State After Drag].
 * All intermediate "during drag" states are discarded.
 */
export const useHistoryBatcher = () => {
    // We access the store directly to call pause/resume
    const project = useProjectData(); // Just to ensure we are inside the provider context if needed, though mostly for logic.
    const updateSettings = useProjectStore(s => s.updateSettings);

    const isInteracting = useRef(false);
    const hasPaused = useRef(false);

    /**
     * Call this when the user starts an interaction (onPointerDown, onClick to open).
     */
    const startInteraction = useCallback(() => {
        isInteracting.current = true;
        hasPaused.current = false;
        // deliberate: do not pause yet!
    }, []);

    /**
     * Call this when the interaction ends (onPointerUp, onBlur).
     */
    const endInteraction = useCallback(() => {
        if (hasPaused.current) {
            useProjectStore.temporal.getState().resume();
        }
        isInteracting.current = false;
        hasPaused.current = false;
    }, []);

    // Optimization helper
    type DeepPartial<T> = {
        [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
    };

    /**
     * Use this instead of `updateSettings` directly during the interaction.
     */
    const updateWithBatching = useCallback((updates: DeepPartial<typeof project.settings>) => {
        // Check if there are actual changes before applying
        let hasChanges = false;

        // Shallow check of top-level keys for now (optimization tradeoff)
        // Since we are mostly updating nested specific fields, we assume if called, it's likely a change.
        // Or we can do a simple check.
        hasChanges = true;

        updateSettings(updates);

        if (hasChanges && isInteracting.current && !hasPaused.current) {
            useProjectStore.temporal.getState().pause();
            hasPaused.current = true;
        }
    }, [updateSettings]);

    return {
        startInteraction,
        endInteraction,
        updateWithBatching
    };
};
