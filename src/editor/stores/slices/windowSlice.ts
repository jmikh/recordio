import type { StateCreator } from 'zustand';
import type { ProjectState } from '../useProjectStore';
import type { ID, OutputWindow, ViewportMotion } from '../../../core/types';
import { recalculateAutoZooms, shiftManualZooms } from '../../utils/zoomUtils';
import { useUIStore } from '../useUIStore';

export interface WindowSlice {

    updateOutputWindow: (id: ID, updates: Partial<OutputWindow>) => void;
    removeOutputWindow: (id: ID) => void;
    splitWindow: (windowId: ID, splitTimeMs: number) => void;
}

const getSnapshot = () => {
    const state = useUIStore.getState();
    // Only capture serializable UI state, exclude refs
    return {
        canvasMode: state.canvasMode,
        selectedZoomId: state.selectedZoomId,
        selectedWindowId: state.selectedWindowId,
        selectedSettingsPanel: state.selectedSettingsPanel,
        isResizingWindow: state.isResizingWindow,
        pixelsPerSec: state.pixelsPerSec,
        isPlaying: state.isPlaying,
        currentTimeMs: state.currentTimeMs,
        previewTimeMs: state.previewTimeMs,
        showDebugBar: state.showDebugBar
    };
};

const getWindowDuration = (w: OutputWindow) => {
    const speed = w.speed || 1.0;
    return (w.endMs - w.startMs) / speed;
};

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
            const oldSpeed = targetWindow.speed || 1.0;
            const oldDuration = (oldEnd - oldStart) / oldSpeed;

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

            let nextMotions = state.project.timeline.viewportMotions;

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
                    nextMotions = shiftManualZooms(nextMotions, pivot, delta, state.project.settings.zoom.minZoomDurationMs, state.project.settings.zoom.maxZoomDurationMs);
                }

                // 2. Check End Change (Trimming/Extending from RIGHT)
                // If end moves right (increase): We added time to END of window.
                // Output Pivot = outputStartMs + OldDuration. (The end of the old window)
                // Delta = newEnd - oldEnd. (e.g. 200 -> 210 = +10ms)
                // Note: We use OldDuration because that's where the boundary WAS in output time.
                if (newWindow.endMs !== oldEnd) {
                    const delta = newWindow.endMs - oldEnd;
                    const pivot = outputStartMs + oldDuration;
                    nextMotions = shiftManualZooms(nextMotions, pivot, delta, state.project.settings.zoom.minZoomDurationMs, state.project.settings.zoom.maxZoomDurationMs);
                }

                // 3. Check Speed Change
                // If speed changed, the output duration changes even if start/end didn't change
                if (updates.speed !== undefined && newWindow.speed !== oldSpeed) {
                    const newDuration = (newWindow.endMs - newWindow.startMs) / (newWindow.speed || 1.0);
                    const durationDelta = newDuration - oldDuration;

                    // Handle motions in manual mode
                    if (!state.project.settings.zoom.autoZoom) {
                        // Split motions into three categories:
                        // 1. Before this window (outputStartMs) - unchanged
                        // 2. Within this window (outputStartMs to outputStartMs + oldDuration) - need adjustment
                        // 3. After this window (> outputStartMs + oldDuration) - shift by durationDelta

                        const windowOutputEnd = outputStartMs + oldDuration;
                        const beforeWindow: ViewportMotion[] = [];
                        const withinWindow: ViewportMotion[] = [];
                        const afterWindow: ViewportMotion[] = [];

                        nextMotions.forEach(m => {
                            if (m.outputEndTimeMs <= outputStartMs) {
                                beforeWindow.push(m);
                            } else if (m.outputEndTimeMs <= windowOutputEnd) {
                                withinWindow.push(m);
                            } else {
                                afterWindow.push(m);
                            }
                        });

                        // Adjust motions within the window
                        let adjustedWithinWindow: ViewportMotion[] = [];

                        // Speed changes should SCALE the motions, not shift them like trimming
                        // A motion at output time 4s in a 10s window at 1x speed
                        // should be at output time 2s in a 5s window at 2x speed
                        const speedRatio = (newWindow.speed || 1.0) / oldSpeed;

                        let leftBoundary = outputStartMs;
                        for (const m of withinWindow) {
                            // Calculate the relative position within the old window (0 to 1)
                            const relativePosition = (m.outputEndTimeMs - outputStartMs) / oldDuration;

                            // Apply the relative position to the new window duration
                            const newEndTime = outputStartMs + (relativePosition * newDuration);

                            // Scale the duration proportionally
                            const scaledDuration = m.durationMs / speedRatio;

                            // Try to use max duration if possible, otherwise use scaled duration
                            let finalDuration = Math.min(
                                state.project.settings.zoom.maxZoomDurationMs,
                                Math.max(scaledDuration, state.project.settings.zoom.minZoomDurationMs)
                            );

                            // Check if this motion fits without collision
                            const idealStartTime = newEndTime - finalDuration;

                            if (idealStartTime >= leftBoundary) {
                                // Fits perfectly
                                adjustedWithinWindow.push({
                                    ...m,
                                    outputEndTimeMs: newEndTime,
                                    durationMs: finalDuration
                                });
                                leftBoundary = newEndTime;
                            } else {
                                // Collision with previous motion - shrink duration
                                const availableSpace = newEndTime - leftBoundary;

                                if (availableSpace >= state.project.settings.zoom.minZoomDurationMs) {
                                    // Fits with reduced duration
                                    adjustedWithinWindow.push({
                                        ...m,
                                        outputEndTimeMs: newEndTime,
                                        durationMs: availableSpace
                                    });
                                    leftBoundary = newEndTime;
                                }
                                // else: drop the motion due to insufficient space
                            }
                        }

                        // Shift motions after the window
                        const shiftedAfterWindow = afterWindow.map(m => ({
                            ...m,
                            outputEndTimeMs: m.outputEndTimeMs + durationDelta
                        }));

                        // Combine all motions
                        nextMotions = [
                            ...beforeWindow,
                            ...adjustedWithinWindow,
                            ...shiftedAfterWindow
                        ];
                    }
                }
            }


            return {
                uiSnapshot: getSnapshot(),
                project: {
                    ...tempProject,
                    timeline: {
                        ...tempProject.timeline,
                        viewportMotions: nextMotions
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

            let nextMotions = state.project.timeline.viewportMotions;

            if (state.project.settings.zoom.autoZoom) {
                nextMotions = recalculateAutoZooms(tempProject, state.sources, state.userEvents);
            } else {
                // Manual Shift: Delete range
                // Pivot: outputStartMs
                // Delta: -Duration
                const duration = getWindowDuration(targetWindow);
                nextMotions = shiftManualZooms(nextMotions, outputStartMs, -duration, state.project.settings.zoom.minZoomDurationMs, state.project.settings.zoom.maxZoomDurationMs);
            }

            return {
                uiSnapshot: getSnapshot(),
                project: {
                    ...tempProject,
                    timeline: {
                        ...tempProject.timeline,
                        viewportMotions: nextMotions
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

            // 2. Calculate durations for both resulting windows
            const firstWindowDuration = getWindowDuration({ ...originalWin, endMs: splitTimeMs });
            const secondWindowDuration = getWindowDuration({ ...originalWin, startMs: splitTimeMs });

            // 3. Validate minimum duration (100ms) for both windows
            const MIN_WINDOW_DURATION_MS = 100;
            if (firstWindowDuration < MIN_WINDOW_DURATION_MS || secondWindowDuration < MIN_WINDOW_DURATION_MS) {
                console.warn('[splitWindow] Split aborted: Both windows must be at least 100ms', {
                    firstWindowDuration,
                    secondWindowDuration
                });
                return state; // No-op if either window would be too small
            }

            // 4. Shrink original window
            const shrunkWin = { ...originalWin, endMs: splitTimeMs };

            // 5. Create new window
            // We need a way to generate IDs safely. Using randomUUID for now.
            const newWin: OutputWindow = {
                id: crypto.randomUUID(),
                startMs: splitTimeMs,
                endMs: originalWin.endMs,
                speed: originalWin.speed  // Preserve speed from original window
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
