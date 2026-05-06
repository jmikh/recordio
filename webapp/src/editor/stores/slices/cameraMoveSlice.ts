import type { StateCreator } from 'zustand';
import type { ProjectState } from '../useProjectStore';
import type { ID, CameraMoveSegment, CameraMoveSettings } from '@shared/types';
import { recomputeOutputTimes } from '@shared/mappers/timeMapper';
import { getTimeMapper } from '../../hooks/useTimeMapper';

export interface CameraMoveSlice {
    addCameraMove: (segment: CameraMoveSegment) => void;
    updateCameraMove: (id: ID, updates: Partial<CameraMoveSegment>) => void;
    deleteCameraMove: (id: ID) => void;
    clearCameraMoves: () => void;
    toggleCameraMoveEnabled: () => void;
}

export const createCameraMoveSlice: StateCreator<ProjectState, [["zustand/subscribeWithSelector", never], ["temporal", unknown]], [], CameraMoveSlice> = (set, _get, store) => ({
    addCameraMove: (segment) => {
        set(state => {
            const cameraMoveSegments = [...(state.project.timeline.cameraMoveSegments || []), segment]
                .sort((a, b) => a.sourceStartTimeMs - b.sourceStartTimeMs);

            // Stamp output times
            const timeMapper = getTimeMapper(state.project.timeline.outputWindows);
            const stamped = recomputeOutputTimes(cameraMoveSegments, timeMapper);

            return {
                project: {
                    ...state.project,
                    timeline: {
                        ...state.project.timeline,
                        cameraMoveSegments: stamped
                    }
                }
            };
        });
    },

    updateCameraMove: (id, updates) => {
        set(state => {
            const cameraMoveSegments = state.project.timeline.cameraMoveSegments || [];
            const idx = cameraMoveSegments.findIndex(s => s.id === id);
            if (idx === -1) return state;

            const nextSegments = [...cameraMoveSegments];
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
                        cameraMoveSegments: stamped
                    }
                }
            };
        });
    },

    deleteCameraMove: (id) => {
        set(state => {
            const cameraMoveSegments = (state.project.timeline.cameraMoveSegments || []).filter(s => s.id !== id);

            return {
                project: {
                    ...state.project,
                    timeline: {
                        ...state.project.timeline,
                        cameraMoveSegments
                    }
                }
            };
        });
    },

    clearCameraMoves: () => {
        set(state => {
            return {
                project: {
                    ...state.project,
                    timeline: {
                        ...state.project.timeline,
                        cameraMoveSegments: []
                    }
                }
            };
        });
    },

    toggleCameraMoveEnabled: () => {
        set(state => {
            const cameraMove = state.project.settings.cameraMove!;
            const currentEnabled = cameraMove.enabled ?? true;
            return {
                project: {
                    ...state.project,
                    settings: {
                        ...state.project.settings,
                        cameraMove: {
                            ...cameraMove,
                            enabled: !currentEnabled,
                        } as CameraMoveSettings
                    }
                }
            };
        });
    },
});
