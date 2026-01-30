import type { StateCreator } from 'zustand';
import type { ProjectState } from '../useProjectStore';
import type { ID, ZoomAction } from '../../../core/types';
import { useUIStore } from '../useUIStore';

export interface ZoomActionSlice {
    updateZoomAction: (id: ID, action: Partial<ZoomAction>) => void;
    addZoomAction: (action: ZoomAction) => void;
    deleteZoomAction: (id: ID) => void;
    clearZoomActions: () => void;
}

// Helper to capture snapshot (excluding DOM refs to avoid circular references)
const getSnapshot = () => {
    const state = useUIStore.getState();
    const { timelineContainerRef, ...serializableState } = state;
    return serializableState;
};

export const createZoomActionSlice: StateCreator<ProjectState, [["zustand/subscribeWithSelector", never], ["temporal", unknown]], [], ZoomActionSlice> = (set, _get, store) => ({
    updateZoomAction: (id, updates) => {
        if ((store as any).temporal.getState().isTracking) {
            console.log('[Action] updateZoomAction', id, updates);
        }
        set(state => {
            const actions = state.project.timeline.zoomActions;
            const idx = actions.findIndex(m => m.id === id);
            if (idx === -1) return state;

            const nextActions = [...actions];
            nextActions[idx] = { ...nextActions[idx], ...updates };

            // FORCE AUTO ZOOM OFF if it was on
            // This prevents recalc from overwriting our manual work
            const nextSettings = {
                ...state.project.settings,
                zoom: { ...state.project.settings.zoom, autoZoom: false }
            };

            return {
                uiSnapshot: getSnapshot(),
                project: {
                    ...state.project,
                    settings: nextSettings,
                    timeline: {
                        ...state.project.timeline,
                        zoomActions: nextActions
                    }
                }
            };
        });
    },

    addZoomAction: (action) => {
        console.log('[Action] addZoomAction', action);
        set(state => {
            const actions = [...state.project.timeline.zoomActions, action]
                .sort((a, b) => a.outputEndTimeMs - b.outputEndTimeMs);

            const nextSettings = {
                ...state.project.settings,
                zoom: { ...state.project.settings.zoom, autoZoom: false }
            };

            return {
                uiSnapshot: getSnapshot(),
                project: {
                    ...state.project,
                    settings: nextSettings,
                    timeline: {
                        ...state.project.timeline,
                        zoomActions: actions
                    }
                }
            };
        });
    },

    deleteZoomAction: (id) => {
        console.log('[Action] deleteZoomAction', id);
        set(state => {
            const actions = state.project.timeline.zoomActions.filter(m => m.id !== id);

            const nextSettings = {
                ...state.project.settings,
                zoom: { ...state.project.settings.zoom, autoZoom: false }
            };

            return {
                uiSnapshot: getSnapshot(),
                project: {
                    ...state.project,
                    settings: nextSettings,
                    timeline: {
                        ...state.project.timeline,
                        zoomActions: actions
                    }
                }
            };
        });
    },

    clearZoomActions: () => {
        console.log('[Action] clearZoomActions');
        set(state => {
            return {
                uiSnapshot: getSnapshot(), // Implicit snapshot
                project: {
                    ...state.project,
                    timeline: {
                        ...state.project.timeline,
                        zoomActions: []
                    }
                }
            };
        });
    },
});
