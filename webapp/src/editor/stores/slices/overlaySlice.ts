import type { StateCreator } from 'zustand';
import type { ProjectState } from '../useProjectStore';
import type { ID } from '@shared/types';
import type { OverlaySegment, OverlayItem } from '@shared/types/overlay';
import { recomputeOutputTimes } from '@shared/mappers/timeMapper';
import { getTimeMapper } from '../../hooks/useTimeMapper';

export interface OverlaySlice {
    addOverlaySegment: (segment: OverlaySegment) => void;
    updateOverlaySegment: (id: ID, updates: Partial<Pick<OverlaySegment, 'sourceStartTimeMs' | 'sourceEndTimeMs'>>) => void;
    deleteOverlaySegment: (id: ID) => void;
    clearOverlaySegments: () => void;
    /** Update the single overlay item data on a segment */
    updateOverlayItemData: (segmentId: ID, updates: Partial<OverlayItem>) => void;
    toggleOverlayEnabled: () => void;
}

export const createOverlaySlice: StateCreator<ProjectState, [["zustand/subscribeWithSelector", never], ["temporal", unknown]], [], OverlaySlice> = (set, _get, store) => ({

    addOverlaySegment: (segment) => {
        set(state => {
            const overlaySegments = [...state.project.timeline.overlaySegments, segment]
                .sort((a, b) => a.sourceStartTimeMs - b.sourceStartTimeMs);

            const timeMapper = getTimeMapper(state.project.timeline.outputWindows);
            const stamped = recomputeOutputTimes(overlaySegments, timeMapper);

            return {
                project: {
                    ...state.project,
                    timeline: {
                        ...state.project.timeline,
                        overlaySegments: stamped as OverlaySegment[]
                    }
                }
            };
        });
    },

    updateOverlaySegment: (id, updates) => {
        set(state => {
            const overlaySegments = state.project.timeline.overlaySegments;
            const idx = overlaySegments.findIndex(b => b.id === id);
            if (idx === -1) return state;

            const nextSegments = [...overlaySegments];
            nextSegments[idx] = { ...nextSegments[idx], ...updates };

            nextSegments.sort((a, b) => a.sourceStartTimeMs - b.sourceStartTimeMs);

            const timeMapper = getTimeMapper(state.project.timeline.outputWindows);
            const stamped = recomputeOutputTimes(nextSegments, timeMapper);

            return {
                project: {
                    ...state.project,
                    timeline: {
                        ...state.project.timeline,
                        overlaySegments: stamped as OverlaySegment[]
                    }
                }
            };
        });
    },

    deleteOverlaySegment: (id) => {
        set(state => ({
            project: {
                ...state.project,
                timeline: {
                    ...state.project.timeline,
                    overlaySegments: state.project.timeline.overlaySegments.filter(b => b.id !== id)
                }
            }
        }));
    },

    clearOverlaySegments: () => {
        set(state => ({
            project: {
                ...state.project,
                timeline: {
                    ...state.project.timeline,
                    overlaySegments: []
                }
            }
        }));
    },

    updateOverlayItemData: (segmentId, updates) => {
        set(state => {
            const overlaySegments = state.project.timeline.overlaySegments;
            const idx = overlaySegments.findIndex(b => b.id === segmentId);
            if (idx === -1) return state;

            const segment = overlaySegments[idx];
            const nextSegments = [...overlaySegments];
            nextSegments[idx] = {
                ...segment,
                item: { ...segment.item, ...updates } as OverlayItem,
            };

            return {
                project: {
                    ...state.project,
                    timeline: {
                        ...state.project.timeline,
                        overlaySegments: nextSegments
                    }
                }
            };
        });
    },

    toggleOverlayEnabled: () => {
        set(state => {
            const currentEnabled = state.project.settings.overlay?.enabled ?? true;
            return {
                project: {
                    ...state.project,
                    settings: {
                        ...state.project.settings,
                        overlay: {
                            ...state.project.settings.overlay,
                            enabled: !currentEnabled,
                            defaultDurationMs: state.project.settings.overlay?.defaultDurationMs ?? 3000,
                        }
                    }
                }
            };
        });
    },
});
