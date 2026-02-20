import type { StateCreator } from 'zustand';
import type { ProjectState } from '../useProjectStore';
import type { ID, OutputWindow, Project } from '../../../types';
import { calculateAutoZooms, ViewMapper } from '../../../core/zoom';
import { calculateAutoSpotlights } from '../../../core/spotlight/autoSpotlight';
import { getTimeMapper } from '../../hooks/useTimeMapper';
import { recomputeOutputTimes } from '../../../core/mappers/timeMapper';

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

const applyNewWindows = (project: Project, nextWindows: OutputWindow[]): Project => {
    const timeMapper = getTimeMapper(nextWindows);
    const sourceSize = project.screenSource.size;
    const hasSourceSize = sourceSize && sourceSize.width > 0;

    // Zoom
    let nextZoomSegments;
    if (project.settings.zoom.isAuto && hasSourceSize) {
        const viewMapper = new ViewMapper(
            sourceSize, project.settings.outputSize,
            project.settings.screen.padding, project.settings.screen.crop,
            project.screenSource.trackableContentRect,
            project.settings.screen.toolbar.enabled
        );
        nextZoomSegments = calculateAutoZooms(
            project.settings.zoom, viewMapper, timeMapper, project.timeline.focusAreas
        );
    } else {
        nextZoomSegments = recomputeOutputTimes(project.timeline.zoomSegments, timeMapper);
    }

    // Spotlight
    let nextSpotlightSegments;
    if (project.settings.spotlight.isAuto && hasSourceSize) {
        const viewMapper = new ViewMapper(
            sourceSize, project.settings.outputSize,
            project.settings.screen.padding, project.settings.screen.crop,
            project.screenSource.trackableContentRect,
            project.settings.screen.toolbar.enabled
        );
        nextSpotlightSegments = calculateAutoSpotlights(
            viewMapper, timeMapper,
            project.userEvents.hoveredCards || [],
            nextZoomSegments, project.settings.zoom,
            project.settings.spotlight
        );
    } else {
        nextSpotlightSegments = recomputeOutputTimes(project.timeline.spotlightSegments, timeMapper);
    }

    // Captions: always recompute output times
    const nextCaptionSegments = recomputeOutputTimes(project.timeline.captionSegments || [], timeMapper);

    return {
        ...project,
        timeline: {
            ...project.timeline,
            outputWindows: nextWindows,
            zoomSegments: nextZoomSegments,
            spotlightSegments: nextSpotlightSegments,
            captionSegments: nextCaptionSegments,
        },
        updatedAt: new Date()
    };
};

export const createWindowSlice: StateCreator<ProjectState, [["zustand/subscribeWithSelector", never], ["temporal", unknown]], [], WindowSlice> = (set, _get, store) => ({

    updateOutputWindow: (id, updates) => {
        set((state) => {
            const currentWindows = state.project.timeline.outputWindows;
            const windowIndex = currentWindows.findIndex(w => w.id === id);
            if (windowIndex === -1) return state;

            const newWindow = { ...currentWindows[windowIndex], ...updates };
            const nextOutputWindows = currentWindows
                .map(w => w.id === id ? newWindow : w)
                .sort((a, b) => a.startMs - b.startMs);

            return { project: applyNewWindows(state.project, nextOutputWindows) };
        });
    },

    removeOutputWindow: (id) => {

        set((state) => {
            const currentWindows = state.project.timeline.outputWindows;
            if (currentWindows.findIndex(w => w.id === id) === -1) return state;

            const nextOutputWindows = currentWindows.filter(w => w.id !== id);
            return { project: applyNewWindows(state.project, nextOutputWindows) };
        });
    },

    splitWindow: (windowId, splitTimeMs) => {

        set((state) => {
            const windowIndex = state.project.timeline.outputWindows.findIndex(w => w.id === windowId);
            if (windowIndex === -1) return state;

            const originalWin = state.project.timeline.outputWindows[windowIndex];
            const firstWindowDuration = getWindowDuration({ ...originalWin, endMs: splitTimeMs });
            const secondWindowDuration = getWindowDuration({ ...originalWin, startMs: splitTimeMs });

            const MIN_WINDOW_DURATION_MS = 100;
            if (firstWindowDuration < MIN_WINDOW_DURATION_MS || secondWindowDuration < MIN_WINDOW_DURATION_MS) {
                console.warn('[splitWindow] Split aborted: Both windows must be at least 100ms', {
                    firstWindowDuration, secondWindowDuration
                });
                return state;
            }

            const shrunkWin = { ...originalWin, endMs: splitTimeMs };
            const newWin: OutputWindow = {
                id: crypto.randomUUID(),
                startMs: splitTimeMs,
                endMs: originalWin.endMs,
                speed: originalWin.speed
            };

            const nextOutputWindows = [...state.project.timeline.outputWindows];
            nextOutputWindows[windowIndex] = shrunkWin;
            nextOutputWindows.push(newWin);
            nextOutputWindows.sort((a, b) => a.startMs - b.startMs);

            return {
                project: {
                    ...state.project,
                    timeline: { ...state.project.timeline, outputWindows: nextOutputWindows },
                    updatedAt: new Date()
                }
            };
        });
    },

    setOutputWindows: (windows) => {

        set((state) => {
            if (windows.length === 0) {
                console.warn('[setOutputWindows] At least one window required');
                return state;
            }
            const sortedWindows = [...windows].sort((a, b) => a.startMs - b.startMs);
            return { project: applyNewWindows(state.project, sortedWindows) };
        });
    }

});
