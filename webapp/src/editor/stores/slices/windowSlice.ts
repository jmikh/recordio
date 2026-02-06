import type { StateCreator } from 'zustand';
import type { ProjectState } from '../useProjectStore';
import type { ID, OutputWindow, ZoomAction, SpotlightAction } from '../../../types';
import { computeFocusAreas, handleZoomWindowChange, handleZoomWindowRemoval } from '../../utils/zoomMutator';
import { handleSpotlightWindowChange, handleSpotlightWindowRemoval } from '../../utils/spotlightMutator';
import { useUIStore } from '../useUIStore';

export interface WindowSlice {

    updateOutputWindow: (id: ID, updates: Partial<OutputWindow>) => void;
    removeOutputWindow: (id: ID) => void;
    splitWindow: (windowId: ID, splitTimeMs: number) => void;
    setOutputWindows: (windows: OutputWindow[]) => void;
}

const getSnapshot = () => {
    const state = useUIStore.getState();
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

            // Recompute focus areas since output windows changed
            const nextFocusAreas = computeFocusAreas(
                { ...state.project, timeline: { ...state.project.timeline, outputWindows: nextOutputWindows } },
                state.project.userEvents
            );

            const tempProject = {
                ...state.project,
                timeline: {
                    ...state.project.timeline,
                    outputWindows: nextOutputWindows,
                    focusAreas: nextFocusAreas
                }
            };

            // Handle zoom changes via mutator
            const windowChangeParams = {
                outputStartMs,
                oldStart,
                oldEnd,
                oldSpeed,
                oldDuration,
                newWindow,
                zoomSettings: state.project.settings.zoom
            };

            const nextActions = handleZoomWindowChange(
                state.project.timeline.zoomActions,
                windowChangeParams,
                state.project.settings.zoom.isAuto,
                tempProject
            );

            // Handle spotlight changes via mutator
            const spotlightParams = {
                outputStartMs,
                oldStart,
                oldEnd,
                oldSpeed,
                oldDuration,
                newWindow,
                spotlightSettings: state.project.settings.spotlight
            };

            const nextSpotlightActions = handleSpotlightWindowChange(
                state.project.timeline.spotlightActions,
                spotlightParams,
                state.project.settings.spotlight.isAuto,
                tempProject,
                nextActions
            );

            return {
                uiSnapshot: getSnapshot(),
                project: {
                    ...tempProject,
                    timeline: {
                        ...tempProject.timeline,
                        zoomActions: nextActions,
                        spotlightActions: nextSpotlightActions
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

            // Recompute focus areas since output windows changed
            const nextFocusAreas = computeFocusAreas(
                { ...state.project, timeline: { ...state.project.timeline, outputWindows: nextOutputWindows } },
                state.project.userEvents
            );

            const tempProject = {
                ...state.project,
                timeline: {
                    ...state.project.timeline,
                    outputWindows: nextOutputWindows,
                    focusAreas: nextFocusAreas
                }
            };

            const windowDuration = getWindowDuration(targetWindow);

            // Handle zoom removal via mutator
            const nextActions = handleZoomWindowRemoval(
                state.project.timeline.zoomActions,
                outputStartMs,
                windowDuration,
                state.project.settings.zoom,
                state.project.settings.zoom.isAuto,
                tempProject
            );

            // Handle spotlight removal via mutator
            const nextSpotlightActions = handleSpotlightWindowRemoval(
                state.project.timeline.spotlightActions,
                outputStartMs,
                windowDuration,
                state.project.settings.spotlight,
                state.project.settings.spotlight.isAuto,
                tempProject,
                nextActions
            );

            return {
                uiSnapshot: getSnapshot(),
                project: {
                    ...tempProject,
                    timeline: {
                        ...tempProject.timeline,
                        zoomActions: nextActions,
                        spotlightActions: nextSpotlightActions
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
            if (windowIndex === -1) return state;

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
                return state;
            }

            // 4. Shrink original window
            const shrunkWin = { ...originalWin, endMs: splitTimeMs };

            // 5. Create new window
            const newWin: OutputWindow = {
                id: crypto.randomUUID(),
                startMs: splitTimeMs,
                endMs: originalWin.endMs,
                speed: originalWin.speed
            };

            // 4. Construct new window list
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
    },

    setOutputWindows: (windows) => {
        console.log('[Action] setOutputWindows', windows.length);
        set((state) => {
            // Validate: at least one window required
            if (windows.length === 0) {
                console.warn('[setOutputWindows] At least one window required');
                return state;
            }

            // Sort by start time
            const sortedWindows = [...windows].sort((a, b) => a.startMs - b.startMs);

            // Recompute focus areas
            const nextFocusAreas = computeFocusAreas(
                { ...state.project, timeline: { ...state.project.timeline, outputWindows: sortedWindows } },
                state.project.userEvents
            );

            const tempProject = {
                ...state.project,
                timeline: {
                    ...state.project.timeline,
                    outputWindows: sortedWindows,
                    focusAreas: nextFocusAreas
                }
            };

            // Recalculate zooms if auto mode
            const nextActions = state.project.settings.zoom.isAuto
                ? handleZoomWindowChange(
                    [], // Start fresh for auto mode
                    {
                        outputStartMs: 0,
                        oldStart: 0,
                        oldEnd: 0,
                        oldSpeed: 1,
                        oldDuration: 0,
                        newWindow: sortedWindows[0],
                        zoomSettings: state.project.settings.zoom
                    },
                    true,
                    tempProject
                )
                : []; // Clear manual zooms since timeline structure changed completely

            // Recalculate spotlights if auto mode
            const nextSpotlightActions = state.project.settings.spotlight.isAuto
                ? handleSpotlightWindowChange(
                    [],
                    {
                        outputStartMs: 0,
                        oldStart: 0,
                        oldEnd: 0,
                        oldSpeed: 1,
                        oldDuration: 0,
                        newWindow: sortedWindows[0],
                        spotlightSettings: state.project.settings.spotlight
                    },
                    true,
                    tempProject,
                    nextActions
                )
                : []; // Clear manual spotlights

            return {
                uiSnapshot: getSnapshot(),
                project: {
                    ...tempProject,
                    timeline: {
                        ...tempProject.timeline,
                        zoomActions: nextActions,
                        spotlightActions: nextSpotlightActions
                    },
                    updatedAt: new Date()
                }
            };
        });
    }

});
