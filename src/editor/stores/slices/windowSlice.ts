
import type { StateCreator } from 'zustand';
import type { ProjectState } from '../useProjectStore';
import type { ID, OutputWindow } from '../../../core/types';
import { recalculateAutoZooms } from '../../utils/zoomUtils';

export interface WindowSlice {
    addOutputWindow: (window: OutputWindow) => void;
    updateOutputWindow: (id: ID, updates: Partial<OutputWindow>) => void;
    removeOutputWindow: (id: ID) => void;
    splitWindow: (windowId: ID, splitTimeMs: number) => void;
    clearWindows: () => void;
}

export const createWindowSlice: StateCreator<ProjectState, [["zustand/subscribeWithSelector", never], ["temporal", unknown]], [], WindowSlice> = (set) => ({
    addOutputWindow: (window) => {
        console.log('[Action] addOutputWindow', window);
        set((state) => {
            const nextOutputWindows = [...state.project.timeline.outputWindows, window].sort((a, b) => a.startMs - b.startMs);

            // Temporary project state to calculate zooms
            const tempProject = {
                ...state.project,
                timeline: {
                    ...state.project.timeline,
                    outputWindows: nextOutputWindows
                }
            };
            const nextMotions = recalculateAutoZooms(tempProject, state.sources, state.userEvents);

            return {
                project: {
                    ...tempProject,
                    timeline: {
                        ...tempProject.timeline,
                        recording: {
                            ...tempProject.timeline.recording,
                            viewportMotions: nextMotions
                        }
                    },
                    updatedAt: new Date()
                }
            };
        });
    },

    updateOutputWindow: (id, updates) => {
        console.log('[Action] updateOutputWindow', id, updates);
        set((state) => {
            const nextOutputWindows = state.project.timeline.outputWindows
                .map(w => w.id === id ? { ...w, ...updates } : w)
                .sort((a, b) => a.startMs - b.startMs);

            const tempProject = {
                ...state.project,
                timeline: {
                    ...state.project.timeline,
                    outputWindows: nextOutputWindows
                }
            };
            const nextMotions = recalculateAutoZooms(tempProject, state.sources, state.userEvents);

            return {
                project: {
                    ...tempProject,
                    timeline: {
                        ...tempProject.timeline,
                        recording: {
                            ...tempProject.timeline.recording,
                            viewportMotions: nextMotions
                        }
                    },
                    updatedAt: new Date()
                }
            };
        });
    },

    removeOutputWindow: (id) => {
        console.log('[Action] removeOutputWindow', id);
        set((state) => {
            const nextOutputWindows = state.project.timeline.outputWindows.filter(w => w.id !== id);

            const tempProject = {
                ...state.project,
                timeline: {
                    ...state.project.timeline,
                    outputWindows: nextOutputWindows
                }
            };
            const nextMotions = recalculateAutoZooms(tempProject, state.sources, state.userEvents);

            // Clear selection if deleted
            const nextSelected = state.selectedWindowId === id ? null : state.selectedWindowId;

            return {
                selectedWindowId: nextSelected,
                project: {
                    ...tempProject,
                    timeline: {
                        ...tempProject.timeline,
                        recording: {
                            ...tempProject.timeline.recording,
                            viewportMotions: nextMotions
                        }
                    },
                    updatedAt: new Date()
                }
            };
        });
    },

    splitWindow: (windowId, splitTimeMs) => {
        console.log('[Action] splitWindow', windowId, splitTimeMs);
        set((state) => {
            // 1. Find the window to split
            const windowIndex = state.project.timeline.outputWindows.findIndex(w => w.id === windowId);
            if (windowIndex === -1) return state; // No-op if not found

            const originalWin = state.project.timeline.outputWindows[windowIndex];

            // 2. Shrink original window
            const shrunkWin = { ...originalWin, endMs: splitTimeMs };

            // 3. Create new window
            // We need a way to generate IDs safely. Using randomUUID for now.
            const newWin: OutputWindow = {
                id: crypto.randomUUID(),
                startMs: splitTimeMs,
                endMs: originalWin.endMs
            };

            // 4. Construct new window list
            // We replace the original with shrunk, and append the new one.
            // Then sort.
            let nextOutputWindows = [...state.project.timeline.outputWindows];
            nextOutputWindows[windowIndex] = shrunkWin;
            nextOutputWindows.push(newWin);
            nextOutputWindows.sort((a, b) => a.startMs - b.startMs);

            // 5. Recalculate Zooms (Atomic!)
            const tempProject = {
                ...state.project,
                timeline: {
                    ...state.project.timeline,
                    outputWindows: nextOutputWindows
                }
            };
            const nextMotions = recalculateAutoZooms(tempProject, state.sources, state.userEvents);

            return {
                project: {
                    ...tempProject,
                    timeline: {
                        ...tempProject.timeline,
                        recording: {
                            ...tempProject.timeline.recording,
                            viewportMotions: nextMotions
                        }
                    },
                    updatedAt: new Date()
                }
            };
        });
    },

    clearWindows: () => {
        console.log('[Action] clearWindows');
        set((state) => {
            const tempProject = {
                ...state.project,
                timeline: {
                    ...state.project.timeline,
                    outputWindows: []
                }
            };
            const nextMotions = recalculateAutoZooms(tempProject, state.sources, state.userEvents);

            return {
                selectedWindowId: null,
                project: {
                    ...tempProject,
                    timeline: {
                        ...tempProject.timeline,
                        recording: {
                            ...tempProject.timeline.recording,
                            viewportMotions: nextMotions
                        }
                    },
                    updatedAt: new Date()
                }
            };
        });
    }

});
