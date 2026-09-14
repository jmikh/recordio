import type { StateCreator } from 'zustand';
import type { ProjectState } from '../useProjectStore';
import type { ID, ZoomSegment, ZoomSettings } from '@shared/types';
import { recomputeOutputTimes } from '@shared/mappers/timeMapper';
import { getTimeMapper } from '../../hooks/useTimeMapper';
import { calculateAutoZooms, getAllFocusAreas } from '../../zoom';
import { ViewMapper } from '@shared/mappers/viewMapper';
import { getDeviceFrame } from '@shared/utils/deviceFrames';

export interface ZoomSegmentSlice {
    updateZoomSegment: (id: ID, action: Partial<ZoomSegment>) => void;
    addZoomSegment: (action: ZoomSegment) => void;
    deleteZoomSegment: (id: ID) => void;
    clearZoomSegments: () => void;
    /** Regenerates the auto zooms. Returns how many were created (0 = no usable focus areas). */
    resetZooms: () => number;
    toggleZoomEnabled: () => void;
    /**
     * Motion settings / inspector "apply to all": one undo step that merges
     * the look into settings.zoom (new zooms inherit it) and stamps it on
     * every existing zoom segment.
     */
    applyZoomSettingsToAll: (updates: Partial<Pick<ZoomSettings, 'transitionDurationMs' | 'easing'>>) => void;
}

export const createZoomSegmentSlice: StateCreator<ProjectState, [["zustand/subscribeWithSelector", never], ["temporal", unknown]], [], ZoomSegmentSlice> = (set, _get, store) => ({
    updateZoomSegment: (id, updates) => {
        set(state => {
            const actions = state.project.timeline.zoomSegments;
            const idx = actions.findIndex(m => m.id === id);
            if (idx === -1) return state;

            const nextActions = [...actions];
            nextActions[idx] = { ...nextActions[idx], ...updates };

            // Stamp output times on the updated segment
            const timeMapper = getTimeMapper(state.project.timeline.outputWindows);
            const stamped = recomputeOutputTimes(nextActions, timeMapper);

            return {
                project: {
                    ...state.project,
                    timeline: {
                        ...state.project.timeline,
                        zoomSegments: stamped
                    }
                }
            };
        });
    },

    addZoomSegment: (action) => {

        set(state => {
            const actions = [...state.project.timeline.zoomSegments, action]
                .sort((a, b) => a.sourceEndTimeMs - b.sourceEndTimeMs);

            // Stamp output times on the new segment
            const timeMapper = getTimeMapper(state.project.timeline.outputWindows);
            const stamped = recomputeOutputTimes(actions, timeMapper);

            return {
                project: {
                    ...state.project,
                    timeline: {
                        ...state.project.timeline,
                        zoomSegments: stamped
                    }
                }
            };
        });
    },

    deleteZoomSegment: (id) => {

        set(state => {
            const actions = state.project.timeline.zoomSegments.filter(m => m.id !== id);

            return {
                project: {
                    ...state.project,
                    timeline: {
                        ...state.project.timeline,
                        zoomSegments: actions
                    }
                }
            };
        });
    },

    clearZoomSegments: () => {

        set(state => {
            return {
                project: {
                    ...state.project,
                    timeline: {
                        ...state.project.timeline,
                        zoomSegments: []
                    }
                }
            };
        });
    },

    resetZooms: () => {
        let generatedCount = 0;

        set(state => {
            const project = state.project;
            const sourceSize = project.screenSource.size;
            const hasUserEvents = state.userEvents.mousePositions.length > 0;

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
            const focusAreas = getAllFocusAreas(state.userEvents, sourceSize, project.screenSource.durationMs);
            const zoomSegments = calculateAutoZooms(
                project.settings.zoom,
                viewMapper,
                timeMapper,
                focusAreas
            );

            generatedCount = zoomSegments.length;

            return {
                project: {
                    ...project,
                    timeline: {
                        ...project.timeline,
                        zoomSegments
                    }
                }
            };
        });

        return generatedCount;
    },

    applyZoomSettingsToAll: (updates) => {
        set(state => ({
            project: {
                ...state.project,
                settings: {
                    ...state.project.settings,
                    zoom: { ...state.project.settings.zoom, ...updates },
                },
                timeline: {
                    ...state.project.timeline,
                    zoomSegments: state.project.timeline.zoomSegments.map(z => ({ ...z, ...updates })),
                },
            },
        }));
    },

    toggleZoomEnabled: () => {
        set(state => {
            const currentEnabled = state.project.settings.zoom.enabled ?? true;
            return {
                project: {
                    ...state.project,
                    settings: {
                        ...state.project.settings,
                        zoom: {
                            ...state.project.settings.zoom,
                            enabled: !currentEnabled,
                        }
                    }
                }
            };
        });
    },
});
