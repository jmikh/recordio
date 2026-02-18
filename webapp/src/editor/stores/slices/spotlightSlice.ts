import type { StateCreator } from 'zustand';
import type { ProjectState } from '../useProjectStore';
import type { ID, SpotlightSegment } from '../../../types';

export interface SpotlightSlice {
    updateSpotlight: (id: ID, spotlight: Partial<SpotlightSegment>) => void;
    addSpotlight: (spotlight: SpotlightSegment) => void;
    deleteSpotlight: (id: ID) => void;
    clearSpotlights: () => void;
}

export const createSpotlightSlice: StateCreator<ProjectState, [["zustand/subscribeWithSelector", never], ["temporal", unknown]], [], SpotlightSlice> = (set, _get, store) => ({
    updateSpotlight: (id, updates) => {
        if ((store as any).temporal.getState().isTracking) {
            console.log('[Action] updateSpotlight', id, updates);
        }
        set(state => {
            const spotlightSegments = state.project.timeline.spotlightSegments;
            const idx = spotlightSegments.findIndex(s => s.id === id);
            if (idx === -1) return state;

            const nextSpotlightSegments = [...spotlightSegments];
            nextSpotlightSegments[idx] = { ...nextSpotlightSegments[idx], ...updates };

            // Sort by start time to maintain order
            nextSpotlightSegments.sort((a, b) => a.sourceStartTimeMs - b.sourceStartTimeMs);

            // If sourceRect is being changed, set isAuto to false
            const nextSettings = updates.sourceRect
                ? { ...state.project.settings, spotlight: { ...state.project.settings.spotlight, isAuto: false } }
                : state.project.settings;

            return {
                project: {
                    ...state.project,
                    settings: nextSettings,
                    timeline: {
                        ...state.project.timeline,
                        spotlightSegments: nextSpotlightSegments
                    }
                }
            };
        });
    },

    addSpotlight: (spotlight) => {
        console.log('[Action] addSpotlight', spotlight);
        set(state => {
            const spotlightSegments = [...state.project.timeline.spotlightSegments, spotlight]
                .sort((a, b) => a.sourceStartTimeMs - b.sourceStartTimeMs);

            // Manual spotlight addition sets isAuto to false
            return {
                project: {
                    ...state.project,
                    settings: {
                        ...state.project.settings,
                        spotlight: {
                            ...state.project.settings.spotlight,
                            isAuto: false
                        }
                    },
                    timeline: {
                        ...state.project.timeline,
                        spotlightSegments
                    }
                }
            };
        });
    },

    deleteSpotlight: (id) => {
        console.log('[Action] deleteSpotlight', id);
        set(state => {
            const spotlightSegments = state.project.timeline.spotlightSegments.filter(s => s.id !== id);

            return {
                project: {
                    ...state.project,
                    timeline: {
                        ...state.project.timeline,
                        spotlightSegments
                    }
                }
            };
        });
    },

    clearSpotlights: () => {
        console.log('[Action] clearSpotlights');
        set(state => {
            return {
                project: {
                    ...state.project,
                    timeline: {
                        ...state.project.timeline,
                        spotlightSegments: []
                    }
                }
            };
        });
    },
});
