import type { StateCreator } from 'zustand';
import type { ProjectState } from '../useProjectStore';
import type { ID } from '../../../types';
import type { OverlaySegment, OverlayItem } from '../../../types/overlay';
import { recomputeOutputTimes } from '../../../core/mappers/timeMapper';
import { getTimeMapper } from '../../hooks/useTimeMapper';

export interface OverlaySlice {
    addOverlaySegment: (segment: OverlaySegment) => void;
    updateOverlaySegment: (id: ID, updates: Partial<Pick<OverlaySegment, 'sourceStartTimeMs' | 'sourceEndTimeMs'>>) => void;
    deleteOverlaySegment: (id: ID) => void;
    clearOverlaySegments: () => void;
    addOverlayItem: (segmentId: ID, item: OverlayItem) => void;
    updateOverlayItem: (segmentId: ID, itemId: ID, updates: Partial<OverlayItem>) => void;
    deleteOverlayItem: (segmentId: ID, itemId: ID) => void;
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

    addOverlayItem: (segmentId, item) => {
        set(state => {
            const overlaySegments = state.project.timeline.overlaySegments;
            const idx = overlaySegments.findIndex(b => b.id === segmentId);
            if (idx === -1) return state;

            // Draw order priority: blur first, then text, border, arrow last
            const TYPE_ORDER: Record<string, number> = { blur: 0, text: 1, border: 2, arrow: 3 };
            const newItems = [...overlaySegments[idx].items, item]
                .sort((a, b) => (TYPE_ORDER[a.type] ?? 9) - (TYPE_ORDER[b.type] ?? 9));

            const nextSegments = [...overlaySegments];
            nextSegments[idx] = { ...nextSegments[idx], items: newItems };

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

    updateOverlayItem: (segmentId, itemId, updates) => {
        set(state => {
            const overlaySegments = state.project.timeline.overlaySegments;
            const segIdx = overlaySegments.findIndex(b => b.id === segmentId);
            if (segIdx === -1) return state;

            const segment = overlaySegments[segIdx];
            const itemIdx = segment.items.findIndex(i => i.id === itemId);
            if (itemIdx === -1) return state;

            const nextItems = [...segment.items];
            nextItems[itemIdx] = { ...nextItems[itemIdx], ...updates } as OverlayItem;

            const nextSegments = [...overlaySegments];
            nextSegments[segIdx] = { ...segment, items: nextItems };

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

    deleteOverlayItem: (segmentId, itemId) => {
        set(state => {
            const overlaySegments = state.project.timeline.overlaySegments;
            const segIdx = overlaySegments.findIndex(b => b.id === segmentId);
            if (segIdx === -1) return state;

            const segment = overlaySegments[segIdx];
            const nextItems = segment.items.filter(i => i.id !== itemId);

            const nextSegments = [...overlaySegments];
            nextSegments[segIdx] = { ...segment, items: nextItems };

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
