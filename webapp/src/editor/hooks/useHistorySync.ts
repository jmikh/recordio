import { useEffect, useRef } from 'react';
import { useProjectStore, useProjectHistory } from '../stores/useProjectStore';
import { useUIStore } from '../stores/useUIStore';

/**
 * Syncs the UI Store (selection, modes) with the Project History.
 * We only want to restore the UI snapshot when determining that an Undo or Redo has occurred.
 * We infer this by watching the length of 'futureStates' in the temporal store.
 * 
 * - Undo: futureStates.length increases (0->1, 1->2...)
 * - Redo: futureStates.length decreases (2->1, 1->0...)
 * - New Action (at tip): futureStates.length stays 0. (No Sync needed)
 */
export const useHistorySync = () => {
    // Watch future history length to detect navigation
    const futureCount = useProjectHistory(state => state.futureStates.length);
    const prevFutureCount = useRef(futureCount);

    useEffect(() => {
        const prev = prevFutureCount.current;

        // Detect change in future depth implies history navigation (Undo/Redo)
        // OR Branching (middle of history -> new action), which is fine to sync.
        // Importantly, adding actions at the TIP (future=0 -> future=0) will NOT trigger this.
        if (prev !== futureCount) {
            const uiSnapshot = useProjectStore.getState().uiSnapshot;
            if (uiSnapshot) {
                console.log('[HistorySync] Restoring UI Snapshot (History Nav Detected)', uiSnapshot);
                useUIStore.setState(uiSnapshot);
            }
        }

        prevFutureCount.current = futureCount;
    }, [futureCount]);
};
