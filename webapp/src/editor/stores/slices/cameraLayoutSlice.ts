import type { StateCreator } from 'zustand';
import type { ProjectState } from '../useProjectStore';
import type { ID, CameraLayoutSegment, CameraLayoutSettings } from '../../../types';
import { recomputeOutputTimes } from '../../../core/mappers/timeMapper';
import { getTimeMapper } from '../../hooks/useTimeMapper';

export interface CameraLayoutSlice {
    addCameraLayout: (segment: CameraLayoutSegment) => void;
    updateCameraLayout: (id: ID, updates: Partial<CameraLayoutSegment>) => void;
    deleteCameraLayout: (id: ID) => void;
    clearCameraLayouts: () => void;
    toggleCameraLayoutEnabled: () => void;
}

export const createCameraLayoutSlice: StateCreator<ProjectState, [["zustand/subscribeWithSelector", never], ["temporal", unknown]], [], CameraLayoutSlice> = (set, _get, store) => ({
    addCameraLayout: (segment) => {
        set(state => {
            const cameraLayoutSegments = [...(state.project.timeline.cameraLayoutSegments || []), segment]
                .sort((a, b) => a.sourceStartTimeMs - b.sourceStartTimeMs);

            // Stamp output times
            const timeMapper = getTimeMapper(state.project.timeline.outputWindows);
            const stamped = recomputeOutputTimes(cameraLayoutSegments, timeMapper);

            return {
                project: {
                    ...state.project,
                    timeline: {
                        ...state.project.timeline,
                        cameraLayoutSegments: stamped
                    }
                }
            };
        });
    },

    updateCameraLayout: (id, updates) => {
        set(state => {
            const cameraLayoutSegments = state.project.timeline.cameraLayoutSegments || [];
            const idx = cameraLayoutSegments.findIndex(s => s.id === id);
            if (idx === -1) return state;

            const nextSegments = [...cameraLayoutSegments];
            nextSegments[idx] = { ...nextSegments[idx], ...updates };

            // Sort by start time to maintain order
            nextSegments.sort((a, b) => a.sourceStartTimeMs - b.sourceStartTimeMs);

            // Stamp output times
            const timeMapper = getTimeMapper(state.project.timeline.outputWindows);
            const stamped = recomputeOutputTimes(nextSegments, timeMapper);

            return {
                project: {
                    ...state.project,
                    timeline: {
                        ...state.project.timeline,
                        cameraLayoutSegments: stamped
                    }
                }
            };
        });
    },

    deleteCameraLayout: (id) => {
        set(state => {
            const cameraLayoutSegments = (state.project.timeline.cameraLayoutSegments || []).filter(s => s.id !== id);

            return {
                project: {
                    ...state.project,
                    timeline: {
                        ...state.project.timeline,
                        cameraLayoutSegments
                    }
                }
            };
        });
    },

    clearCameraLayouts: () => {
        set(state => {
            return {
                project: {
                    ...state.project,
                    timeline: {
                        ...state.project.timeline,
                        cameraLayoutSegments: []
                    }
                }
            };
        });
    },

    toggleCameraLayoutEnabled: () => {
        set(state => {
            const cameraLayout = state.project.settings.cameraLayout!;
            const currentEnabled = cameraLayout.enabled ?? true;
            return {
                project: {
                    ...state.project,
                    settings: {
                        ...state.project.settings,
                        cameraLayout: {
                            ...cameraLayout,
                            enabled: !currentEnabled,
                        } as CameraLayoutSettings
                    }
                }
            };
        });
    },
});
