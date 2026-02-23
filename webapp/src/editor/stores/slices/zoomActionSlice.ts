import type { StateCreator } from 'zustand';
import type { ProjectState } from '../useProjectStore';
import type { ID, ZoomSegment } from '../../../types';
import { recomputeOutputTimes } from '../../../core/mappers/timeMapper';
import { getTimeMapper } from '../../hooks/useTimeMapper';
import { calculateAutoZooms, ViewMapper, getAllFocusAreas } from '../../../core/zoom';
import { getDeviceFrame } from '../../../core/deviceFrames';

export interface ZoomSegmentSlice {
    updateZoomSegment: (id: ID, action: Partial<ZoomSegment>) => void;
    addZoomSegment: (action: ZoomSegment) => void;
    deleteZoomSegment: (id: ID) => void;
    clearZoomSegments: () => void;
    resetZooms: () => void;
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

        set(state => {
            const project = state.project;
            const sourceSize = project.screenSource.size;
            const hasUserEvents = project.userEvents.mousePositions.length > 0;

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
            const focusAreas = getAllFocusAreas(project.userEvents, sourceSize, project.screenSource.durationMs);
            const zoomSegments = calculateAutoZooms(
                project.settings.zoom,
                viewMapper,
                timeMapper,
                focusAreas
            );

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
    },
});
