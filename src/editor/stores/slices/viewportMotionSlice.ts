import type { StateCreator } from 'zustand';
import type { ProjectState } from '../useProjectStore';
import type { ID, ViewportMotion } from '../../../core/types';
import { useUIStore } from '../useUIStore';

export interface ViewportMotionSlice {
    updateViewportMotion: (id: ID, motion: Partial<ViewportMotion>) => void;
    addViewportMotion: (motion: ViewportMotion) => void;
    deleteViewportMotion: (id: ID) => void;
    clearViewportMotions: () => void;
}

// Helper to capture snapshot
const getSnapshot = () => useUIStore.getState();

export const createViewportMotionSlice: StateCreator<ProjectState, [["zustand/subscribeWithSelector", never], ["temporal", unknown]], [], ViewportMotionSlice> = (set, _get, store) => ({
    updateViewportMotion: (id, updates) => {
        if ((store as any).temporal.getState().isTracking) {
            console.log('[Action] updateViewportMotion', id, updates);
        }
        set(state => {
            const motions = state.project.timeline.recording.viewportMotions;
            const idx = motions.findIndex(m => m.id === id);
            if (idx === -1) return state;

            const nextMotions = [...motions];
            nextMotions[idx] = { ...nextMotions[idx], ...updates };

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
                        recording: {
                            ...state.project.timeline.recording,
                            viewportMotions: nextMotions
                        }
                    }
                }
            };
        });
    },

    addViewportMotion: (motion) => {
        console.log('[Action] addViewportMotion', motion);
        set(state => {
            const motions = [...state.project.timeline.recording.viewportMotions, motion]
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
                        recording: {
                            ...state.project.timeline.recording,
                            viewportMotions: motions
                        }
                    }
                }
            };
        });
    },

    deleteViewportMotion: (id) => {
        console.log('[Action] deleteViewportMotion', id);
        set(state => {
            const motions = state.project.timeline.recording.viewportMotions.filter(m => m.id !== id);

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
                        recording: {
                            ...state.project.timeline.recording,
                            viewportMotions: motions
                        }
                    }
                }
            };
        });
    },

    clearViewportMotions: () => {
        console.log('[Action] clearViewportMotions');
        set(state => {
            return {
                uiSnapshot: getSnapshot(), // Implicit snapshot
                project: {
                    ...state.project,
                    timeline: {
                        ...state.project.timeline,
                        recording: {
                            ...state.project.timeline.recording,
                            viewportMotions: []
                        }
                    }
                }
            };
        });
    },
});
