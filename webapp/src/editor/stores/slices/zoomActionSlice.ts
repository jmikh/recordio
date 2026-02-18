import type { StateCreator } from 'zustand';
import type { ProjectState } from '../useProjectStore';
import type { ID, ZoomSegment } from '../../../types';

export interface ZoomSegmentSlice {
    updateZoomSegment: (id: ID, action: Partial<ZoomSegment>) => void;
    addZoomSegment: (action: ZoomSegment) => void;
    deleteZoomSegment: (id: ID) => void;
    clearZoomSegments: () => void;
}

export const createZoomSegmentSlice: StateCreator<ProjectState, [["zustand/subscribeWithSelector", never], ["temporal", unknown]], [], ZoomSegmentSlice> = (set, _get, store) => ({
    updateZoomSegment: (id, updates) => {
        if ((store as any).temporal.getState().isTracking) {
            console.log('[Action] updateZoomSegment', id, updates);
        }
        set(state => {
            const actions = state.project.timeline.zoomSegments;
            const idx = actions.findIndex(m => m.id === id);
            if (idx === -1) return state;

            const nextActions = [...actions];
            nextActions[idx] = { ...nextActions[idx], ...updates };

            // FORCE AUTO ZOOM OFF if it was on
            // This prevents recalc from overwriting our manual work
            const nextSettings = {
                ...state.project.settings,
                zoom: { ...state.project.settings.zoom, isAuto: false }
            };

            return {
                project: {
                    ...state.project,
                    settings: nextSettings,
                    timeline: {
                        ...state.project.timeline,
                        zoomSegments: nextActions
                    }
                }
            };
        });
    },

    addZoomSegment: (action) => {
        console.log('[Action] addZoomSegment', action);
        set(state => {
            const actions = [...state.project.timeline.zoomSegments, action]
                .sort((a, b) => a.sourceEndTimeMs - b.sourceEndTimeMs);

            const nextSettings = {
                ...state.project.settings,
                zoom: { ...state.project.settings.zoom, isAuto: false }
            };

            return {
                project: {
                    ...state.project,
                    settings: nextSettings,
                    timeline: {
                        ...state.project.timeline,
                        zoomSegments: actions
                    }
                }
            };
        });
    },

    deleteZoomSegment: (id) => {
        console.log('[Action] deleteZoomSegment', id);
        set(state => {
            const actions = state.project.timeline.zoomSegments.filter(m => m.id !== id);

            const nextSettings = {
                ...state.project.settings,
                zoom: { ...state.project.settings.zoom, isAuto: false }
            };

            return {
                project: {
                    ...state.project,
                    settings: nextSettings,
                    timeline: {
                        ...state.project.timeline,
                        zoomSegments: actions
                    }
                }
            };
        });
    },

    clearZoomSegments: () => {
        console.log('[Action] clearZoomSegments');
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
});
