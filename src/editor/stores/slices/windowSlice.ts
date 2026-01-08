import type { StateCreator } from 'zustand';
import type { ProjectState } from '../useProjectStore';
import type { ID, OutputWindow } from '../../../core/types';
import { recalculateAutoZooms, shiftManualZooms } from '../../utils/zoomUtils';
import { useUIStore } from '../useUIStore';

export interface WindowSlice {

    updateOutputWindow: (id: ID, updates: Partial<OutputWindow>) => void;
    removeOutputWindow: (id: ID) => void;
    splitWindow: (windowId: ID, splitTimeMs: number) => void;
}

const getSnapshot = () => useUIStore.getState();

const getWindowDuration = (w: OutputWindow) => w.endMs - w.startMs;

export const createWindowSlice: StateCreator<ProjectState, [["zustand/subscribeWithSelector", never], ["temporal", unknown]], [], WindowSlice> = (set, _get, store) => ({


    updateOutputWindow: (id, updates) => {
        if ((store as any).temporal.getState().isTracking) {
            console.log('[Action] updateOutputWindow', id, updates);
        }
        set((state) => {
            const currentWindows = state.project.timeline.outputWindows;
            const windowIndex = currentWindows.findIndex(w => w.id === id);

            // Should not happen, but safe check
            if (windowIndex === -1) return state;

            const targetWindow = currentWindows[windowIndex];

            // Calculate Pre-change Output Start for this window
            let outputStartMs = 0;
            for (let i = 0; i < windowIndex; i++) {
                outputStartMs += getWindowDuration(currentWindows[i]);
            }

            const oldStart = targetWindow.startMs;
            const oldEnd = targetWindow.endMs;
            const oldDuration = oldEnd - oldStart;

            // Apply updates to get new window
            const newWindow = { ...targetWindow, ...updates };

            const nextOutputWindows = currentWindows
                .map(w => w.id === id ? newWindow : w)
                .sort((a, b) => a.startMs - b.startMs);

            const tempProject = {
                ...state.project,
                timeline: {
                    ...state.project.timeline,
                    outputWindows: nextOutputWindows
                }
            };

            let nextMotions = state.project.timeline.recording.viewportMotions;

            // Zoom Logic
            if (state.project.settings.zoom.autoZoom) {
                nextMotions = recalculateAutoZooms(tempProject, state.sources, state.userEvents);
            } else {
                // Manual Shift Logic
                // We handle Start and End changes separately if both changed (unlikely in single operation but possible)
                // But typically updates has one or the other.

                // 1. Check Start Change (Trimming/Extending from LEFT)
                // If start moves right (increase): We removed time from the BEGINNING of window.
                // Output Pivot = outputStartMs.
                // Delta = oldStart - newStart. (e.g. 100 -> 110 = -10ms)
                if (newWindow.startMs !== oldStart) {
                    const delta = oldStart - newWindow.startMs;
                    // For left-side trim, pivot is at the start of the window in output time
                    const pivot = outputStartMs;
                    nextMotions = shiftManualZooms(nextMotions, pivot, delta);
                }

                // 2. Check End Change (Trimming/Extending from RIGHT)
                // If end moves right (increase): We added time to END of window.
                // Output Pivot = outputStartMs + OldDuration. (The end of the old window)
                // Delta = newEnd - oldEnd. (e.g. 200 -> 210 = +10ms)
                // Note: We use OldDuration because that's where the boundary WAS in output time.
                if (newWindow.endMs !== oldEnd) {
                    const delta = newWindow.endMs - oldEnd;
                    const pivot = outputStartMs + oldDuration;
                    nextMotions = shiftManualZooms(nextMotions, pivot, delta);
                }
            }


            return {
                uiSnapshot: getSnapshot(),
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
            const currentWindows = state.project.timeline.outputWindows;
            const windowIndex = currentWindows.findIndex(w => w.id === id);

            if (windowIndex === -1) return state;

            const targetWindow = currentWindows[windowIndex];

            // Calculate Pre-change Output Start
            let outputStartMs = 0;
            for (let i = 0; i < windowIndex; i++) {
                outputStartMs += getWindowDuration(currentWindows[i]);
            }

            const nextOutputWindows = currentWindows.filter(w => w.id !== id);

            const tempProject = {
                ...state.project,
                timeline: {
                    ...state.project.timeline,
                    outputWindows: nextOutputWindows
                }
            };

            let nextMotions = state.project.timeline.recording.viewportMotions;

            if (state.project.settings.zoom.autoZoom) {
                nextMotions = recalculateAutoZooms(tempProject, state.sources, state.userEvents);
            } else {
                // Manual Shift: Delete range
                // Pivot: outputStartMs
                // Delta: -Duration
                const duration = getWindowDuration(targetWindow);
                nextMotions = shiftManualZooms(nextMotions, outputStartMs, -duration);
            }

            return {
                uiSnapshot: getSnapshot(),
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

            return {
                uiSnapshot: getSnapshot(),
                project: {
                    ...state.project,
                    timeline: {
                        ...state.project.timeline,
                        outputWindows: nextOutputWindows
                    },
                    updatedAt: new Date()
                }
            };
        });
    }

});
