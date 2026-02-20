import type { StateCreator } from 'zustand';
import type { ProjectState } from '../useProjectStore';
import type { ID, SpotlightSegment } from '../../../types';
import { recomputeOutputTimes } from '../../../core/mappers/timeMapper';
import { getTimeMapper } from '../../hooks/useTimeMapper';

export interface SpotlightSlice {
    updateSpotlight: (id: ID, spotlight: Partial<SpotlightSegment>) => void;
    addSpotlight: (spotlight: SpotlightSegment) => void;
    deleteSpotlight: (id: ID) => void;
    clearSpotlights: () => void;
}

export const createSpotlightSlice: StateCreator<ProjectState, [["zustand/subscribeWithSelector", never], ["temporal", unknown]], [], SpotlightSlice> = (set, _get, store) => ({
    updateSpotlight: (id, updates) => {
        set(state => {
            const spotlightSegments = state.project.timeline.spotlightSegments;
            const idx = spotlightSegments.findIndex(s => s.id === id);
            if (idx === -1) return state;

            const nextSpotlightSegments = [...spotlightSegments];
            nextSpotlightSegments[idx] = { ...nextSpotlightSegments[idx], ...updates };

            // Sort by start time to maintain order
            nextSpotlightSegments.sort((a, b) => a.sourceStartTimeMs - b.sourceStartTimeMs);

            // Stamp output times
            const timeMapper = getTimeMapper(state.project.timeline.outputWindows);
            const stamped = recomputeOutputTimes(nextSpotlightSegments, timeMapper);

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
                        spotlightSegments: stamped
                    }
                }
            };
        });
    },

    addSpotlight: (spotlight) => {

        set(state => {
            const spotlightSegments = [...state.project.timeline.spotlightSegments, spotlight]
                .sort((a, b) => a.sourceStartTimeMs - b.sourceStartTimeMs);

            // Stamp output times
            const timeMapper = getTimeMapper(state.project.timeline.outputWindows);
            const stamped = recomputeOutputTimes(spotlightSegments, timeMapper);

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
                        spotlightSegments: stamped
                    }
                }
            };
        });
    },

    deleteSpotlight: (id) => {

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
