import type { StateCreator } from 'zustand';
import type { ProjectState } from '../useProjectStore';
import type { ID, SpotlightAction } from '../../../core/types';
import { useUIStore } from '../useUIStore';

export interface SpotlightSlice {
    updateSpotlight: (id: ID, spotlight: Partial<SpotlightAction>) => void;
    addSpotlight: (spotlight: SpotlightAction) => void;
    deleteSpotlight: (id: ID) => void;
    clearSpotlights: () => void;
}

// Helper to capture snapshot (excluding DOM refs to avoid circular references)
const getSnapshot = () => {
    const state = useUIStore.getState();
    const { timelineContainerRef, ...serializableState } = state;
    return serializableState;
};

export const createSpotlightSlice: StateCreator<ProjectState, [["zustand/subscribeWithSelector", never], ["temporal", unknown]], [], SpotlightSlice> = (set, _get, store) => ({
    updateSpotlight: (id, updates) => {
        if ((store as any).temporal.getState().isTracking) {
            console.log('[Action] updateSpotlight', id, updates);
        }
        set(state => {
            const spotlightActions = state.project.timeline.spotlightActions;
            const idx = spotlightActions.findIndex(s => s.id === id);
            if (idx === -1) return state;

            const nextSpotlightActions = [...spotlightActions];
            nextSpotlightActions[idx] = { ...nextSpotlightActions[idx], ...updates };

            // Sort by start time to maintain order
            nextSpotlightActions.sort((a, b) => a.outputStartTimeMs - b.outputStartTimeMs);

            return {
                uiSnapshot: getSnapshot(),
                project: {
                    ...state.project,
                    timeline: {
                        ...state.project.timeline,
                        spotlightActions: nextSpotlightActions
                    }
                }
            };
        });
    },

    addSpotlight: (spotlight) => {
        console.log('[Action] addSpotlight', spotlight);
        set(state => {
            const spotlightActions = [...state.project.timeline.spotlightActions, spotlight]
                .sort((a, b) => a.outputStartTimeMs - b.outputStartTimeMs);

            return {
                uiSnapshot: getSnapshot(),
                project: {
                    ...state.project,
                    timeline: {
                        ...state.project.timeline,
                        spotlightActions
                    }
                }
            };
        });
    },

    deleteSpotlight: (id) => {
        console.log('[Action] deleteSpotlight', id);
        set(state => {
            const spotlightActions = state.project.timeline.spotlightActions.filter(s => s.id !== id);

            return {
                uiSnapshot: getSnapshot(),
                project: {
                    ...state.project,
                    timeline: {
                        ...state.project.timeline,
                        spotlightActions
                    }
                }
            };
        });
    },

    clearSpotlights: () => {
        console.log('[Action] clearSpotlights');
        set(state => {
            return {
                uiSnapshot: getSnapshot(),
                project: {
                    ...state.project,
                    timeline: {
                        ...state.project.timeline,
                        spotlightActions: []
                    }
                }
            };
        });
    },
});
