import type { StateCreator } from 'zustand';
import type { ProjectState } from '../useProjectStore';
import type { ID, OutputWindow, ZoomSegment, SpotlightSegment, Project, UserEvents, FocusArea } from '../../../types';
import { calculateZoomSchedule, ViewMapper, getAllFocusAreas } from '../../../core/zoom';
import { calculateAutoSpotlights } from '../../../core/spotlight/spotlightScheduler';
import { getTimeMapper } from '../../hooks/useTimeMapper';



export interface WindowSlice {
    updateOutputWindow: (id: ID, updates: Partial<OutputWindow>) => void;
    removeOutputWindow: (id: ID) => void;
    splitWindow: (windowId: ID, splitTimeMs: number) => void;
    setOutputWindows: (windows: OutputWindow[]) => void;
}

const getWindowDuration = (w: OutputWindow) => {
    const speed = w.speed || 1.0;
    return (w.endMs - w.startMs) / speed;
};

const computeFocusAreas = (project: Project, events: UserEvents): FocusArea[] => {
    const sourceSize = project.screenSource.size;
    if (!sourceSize || sourceSize.width === 0) return [];
    return getAllFocusAreas(events, sourceSize, project.screenSource.durationMs);
};

export const recalculateAutoZooms = (project: Project): ZoomSegment[] => {
    if (!project.settings.zoom.isAuto) return project.timeline.zoomSegments;
    const sourceSize = project.screenSource.size;
    if (!sourceSize || sourceSize.width === 0) return project.timeline.zoomSegments;
    const viewMapper = new ViewMapper(
        sourceSize, project.settings.outputSize,
        project.settings.screen.padding, project.settings.screen.crop,
        project.screenSource.trackableContentRect,
        project.settings.screen.toolbar.enabled
    );
    const timeMapper = getTimeMapper(project.timeline.outputWindows);
    return calculateZoomSchedule(project.settings.zoom, viewMapper, timeMapper, project.timeline.focusAreas);
};

export const recalculateAutoSpotlights = (project: Project, zoomSegments: ZoomSegment[]): SpotlightSegment[] => {
    if (!project.settings.spotlight.isAuto) return project.timeline.spotlightSegments;
    const sourceSize = project.screenSource.size;
    if (!sourceSize || sourceSize.width === 0) return project.timeline.spotlightSegments;
    const viewMapper = new ViewMapper(
        sourceSize, project.settings.outputSize,
        project.settings.screen.padding, project.settings.screen.crop,
        project.screenSource.trackableContentRect,
        project.settings.screen.toolbar.enabled
    );
    const timeMapper = getTimeMapper(project.timeline.outputWindows);
    return calculateAutoSpotlights(
        viewMapper, timeMapper,
        project.userEvents.hoveredCards || [],
        zoomSegments, project.settings.zoom,
        project.settings.spotlight.enlargeScale
    );
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

            // Zoom: auto recalculates, manual stays as-is (source time anchored)
            const nextActions = state.project.settings.zoom.isAuto
                ? recalculateAutoZooms(tempProject)
                : state.project.timeline.zoomSegments;

            // Spotlight: auto recalculates, manual stays as-is (source time anchored)
            const nextSpotlightSegments = recalculateAutoSpotlights(tempProject, nextActions);

            return {
                project: {
                    ...tempProject,
                    timeline: {
                        ...tempProject.timeline,
                        zoomSegments: nextActions,
                        spotlightSegments: nextSpotlightSegments
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

            // Zoom: auto recalculates, manual stays as-is (source time anchored, auto-hidden)
            const nextActions = state.project.settings.zoom.isAuto
                ? recalculateAutoZooms(tempProject)
                : state.project.timeline.zoomSegments;

            // Spotlight: auto recalculates, manual stays as-is (source time anchored)
            const nextSpotlightSegments = recalculateAutoSpotlights(tempProject, nextActions);

            return {
                project: {
                    ...tempProject,
                    timeline: {
                        ...tempProject.timeline,
                        zoomSegments: nextActions,
                        spotlightSegments: nextSpotlightSegments
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

            // Zoom: auto recalculates, manual cleared (full timeline rebuild)
            const nextActions = state.project.settings.zoom.isAuto
                ? recalculateAutoZooms(tempProject)
                : [];

            // Spotlight: auto recalculates, manual cleared (full timeline rebuild)
            const nextSpotlightSegments = recalculateAutoSpotlights(tempProject, nextActions);

            return {
                project: {
                    ...tempProject,
                    timeline: {
                        ...tempProject.timeline,
                        zoomSegments: nextActions,
                        spotlightSegments: nextSpotlightSegments
                    },
                    updatedAt: new Date()
                }
            };
        });
    }

});
