import type { StateCreator } from 'zustand';
import type { ProjectState } from '../useProjectStore';
import type { ID, SpotlightSegment, SpotlightSettings } from '@shared/types';
import { recomputeOutputTimes } from '@shared/mappers/timeMapper';
import { getTimeMapper } from '../../hooks/useTimeMapper';
import { calculateAutoSpotlights } from '../../spotlight/autoSpotlight';
import { ViewMapper } from '@shared/mappers/viewMapper';
import { getDeviceFrame } from '@shared/utils/deviceFrames';

export interface SpotlightSlice {
    updateSpotlight: (id: ID, spotlight: Partial<SpotlightSegment>) => void;
    addSpotlight: (spotlight: SpotlightSegment) => void;
    deleteSpotlight: (id: ID) => void;
    clearSpotlights: () => void;
    resetSpotlights: () => void;
    toggleSpotlightEnabled: () => void;
    /**
     * Motion settings / inspector "apply to all": one undo step that merges
     * the look into settings.spotlight (new spotlights inherit it) and stamps
     * it on every existing segment (enlargeScale → segment.scale).
     */
    applySpotlightSettingsToAll: (
        updates: Partial<Pick<SpotlightSettings, 'dimOpacity' | 'enlargeScale' | 'transitionDurationMs' | 'easing'>>,
    ) => void;
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

            return {
                project: {
                    ...state.project,
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

            return {
                project: {
                    ...state.project,
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

    resetSpotlights: () => {

        set(state => {
            const project = state.project;
            const sourceSize = project.screenSource.size;

            if (!project.screenSource.trackableContentRect) {
                return state;
            }

            const deviceFrame = project.settings.screen.mode === 'device'
                ? getDeviceFrame(project.settings.screen.deviceFrameId)
                : undefined;

            const viewMapper = new ViewMapper(
                sourceSize,
                project.settings.outputSize,
                project.settings.screen.padding,
                project.settings.screen.crop,
                project.screenSource.trackableContentRect,
                project.settings.screen.toolbar.enabled,
                deviceFrame
            );
            const timeMapper = getTimeMapper(project.timeline.outputWindows);
            const spotlightSegments = calculateAutoSpotlights(
                viewMapper,
                timeMapper,
                state.userEvents.hoveredCards || [],
                project.timeline.zoomSegments,
                project.settings.zoom,
                project.settings.spotlight
            );

            return {
                project: {
                    ...project,
                    timeline: {
                        ...project.timeline,
                        spotlightSegments
                    }
                }
            };
        });
    },

    applySpotlightSettingsToAll: (updates) => {
        set(state => {
            const { enlargeScale, ...rest } = updates;
            const perSegment: Partial<SpotlightSegment> = { ...rest, ...(enlargeScale !== undefined ? { scale: enlargeScale } : {}) };
            return {
                project: {
                    ...state.project,
                    settings: {
                        ...state.project.settings,
                        spotlight: { ...state.project.settings.spotlight, ...updates },
                    },
                    timeline: {
                        ...state.project.timeline,
                        spotlightSegments: state.project.timeline.spotlightSegments.map(s => ({ ...s, ...perSegment })),
                    },
                },
            };
        });
    },

    toggleSpotlightEnabled: () => {
        set(state => {
            const currentEnabled = state.project.settings.spotlight.enabled ?? true;
            return {
                project: {
                    ...state.project,
                    settings: {
                        ...state.project.settings,
                        spotlight: {
                            ...state.project.settings.spotlight,
                            enabled: !currentEnabled,
                        }
                    }
                }
            };
        });
    },
});
