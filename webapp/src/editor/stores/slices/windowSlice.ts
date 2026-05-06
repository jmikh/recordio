import type { StateCreator } from 'zustand';
import type { ProjectState } from '../useProjectStore';
import type { ID, OutputWindow, Project } from '@shared/types';
import { getTimeMapper } from '../../hooks/useTimeMapper';
import { recomputeOutputTimes, TimeMapper } from '@shared/mappers/timeMapper';
import type { CaptionSegment } from '@shared/types';

/** Recomputes output times for caption segments AND their nested words. */
export function recomputeCaptionOutputTimes(
    segments: CaptionSegment[],
    timeMapper: TimeMapper
): CaptionSegment[] {
    return recomputeOutputTimes(segments, timeMapper).map(segment => ({
        ...segment,
        words: recomputeOutputTimes(segment.words, timeMapper),
    }));
}

export interface WindowSlice {
    updateOutputWindow: (id: ID, updates: Partial<OutputWindow>) => void;
    removeOutputWindow: (id: ID) => void;
    splitWindow: (windowId: ID, splitTimeMs: number) => void;
    mergeWindows: (keepId: ID, removeId: ID) => void;
    setOutputWindows: (windows: OutputWindow[]) => void;
    resetWindows: () => void;
    /** Cut a source time range out of output windows, creating a gap (trim). */
    cutSourceRange: (startMs: number, endMs: number) => void;
    /** Cut an output time range, converting to source time per-window. */
    cutOutputRange: (outputStartMs: number, outputEndMs: number) => void;
}

const getWindowDuration = (w: OutputWindow) => {
    const speed = w.speed || 1.0;
    return (w.endMs - w.startMs) / speed;
};

const applyNewWindows = (project: Project, nextWindows: OutputWindow[]): Project => {
    const timeMapper = getTimeMapper(nextWindows);

    // Zoom: recompute output times for existing segments
    const nextZoomSegments = recomputeOutputTimes(project.timeline.zoomSegments, timeMapper);

    // Spotlight: recompute output times for existing segments
    const nextSpotlightSegments = recomputeOutputTimes(project.timeline.spotlightSegments, timeMapper);

    // Captions: recompute output times on segments AND their nested words
    const nextCaptionSegments = recomputeCaptionOutputTimes(project.timeline.captionSegments || [], timeMapper);

    // Overlays: recompute output times for overlay segments
    const nextOverlaySegments = recomputeOutputTimes(project.timeline.overlaySegments || [], timeMapper);

    return {
        ...project,
        timeline: {
            ...project.timeline,
            outputWindows: nextWindows,
            zoomSegments: nextZoomSegments,
            spotlightSegments: nextSpotlightSegments,
            captionSegments: nextCaptionSegments,
            overlaySegments: nextOverlaySegments,
        },
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

    mergeWindows: (keepId, removeId) => {
        set((state) => {
            const currentWindows = state.project.timeline.outputWindows;
            const keepWin = currentWindows.find(w => w.id === keepId);
            const removeWin = currentWindows.find(w => w.id === removeId);
            if (!keepWin || !removeWin) return state;

            const mergedWindow: OutputWindow = {
                id: keepId,
                startMs: Math.min(keepWin.startMs, removeWin.startMs),
                endMs: Math.max(keepWin.endMs, removeWin.endMs),
                speed: keepWin.speed
            };

            const nextOutputWindows = currentWindows
                .filter(w => w.id !== removeId)
                .map(w => w.id === keepId ? mergedWindow : w)
                .sort((a, b) => a.startMs - b.startMs);

            return { project: applyNewWindows(state.project, nextOutputWindows) };
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
    },

    resetWindows: () => {
        set((state) => {
            const currentWindows = state.project.timeline.outputWindows;
            if (currentWindows.length === 0) return state;

            const sourceDurationMs = state.project.timeline.durationMs;

            const resetWindow: OutputWindow = {
                id: currentWindows[0].id,
                startMs: 0,
                endMs: sourceDurationMs,
                speed: 1.0,
            };

            return { project: applyNewWindows(state.project, [resetWindow]) };
        });
    },

    cutSourceRange: (cutStart: number, cutEnd: number) => {
        set((state) => {
            const currentWindows = state.project.timeline.outputWindows;
            const MIN_WINDOW_DURATION_MS = 100;
            const nextWindows: OutputWindow[] = [];

            for (const win of currentWindows) {
                // No overlap — keep window as-is
                if (cutEnd <= win.startMs || cutStart >= win.endMs) {
                    nextWindows.push(win);
                    continue;
                }

                // Left portion survives
                if (cutStart > win.startMs) {
                    const leftEnd = cutStart;
                    if (getWindowDuration({ ...win, endMs: leftEnd }) >= MIN_WINDOW_DURATION_MS) {
                        nextWindows.push({ ...win, endMs: leftEnd });
                    }
                }

                // Right portion survives
                if (cutEnd < win.endMs) {
                    const rightStart = cutEnd;
                    if (getWindowDuration({ ...win, startMs: rightStart }) >= MIN_WINDOW_DURATION_MS) {
                        nextWindows.push({
                            id: crypto.randomUUID(),
                            startMs: rightStart,
                            endMs: win.endMs,
                            speed: win.speed,
                        });
                    }
                }
            }

            // Don't allow empty windows — keep at least one
            if (nextWindows.length === 0) {
                console.warn('[cutSourceRange] Cut would remove all windows — aborting');
                return state;
            }

            nextWindows.sort((a, b) => a.startMs - b.startMs);
            return { project: applyNewWindows(state.project, nextWindows) };
        });
    },

    cutOutputRange: (outputStartMs: number, outputEndMs: number) => {
        set((state) => {
            const currentWindows = state.project.timeline.outputWindows;
            const MIN_WINDOW_DURATION_MS = 100;
            const nextWindows: OutputWindow[] = [];

            let outputAccumulator = 0;

            for (const win of currentWindows) {
                const speed = win.speed || 1.0;
                const windowOutputDuration = (win.endMs - win.startMs) / speed;
                const windowOutputStart = outputAccumulator;
                const windowOutputEnd = outputAccumulator + windowOutputDuration;
                outputAccumulator = windowOutputEnd;

                // No overlap with highlight range: keep entire window
                if (outputEndMs <= windowOutputStart || outputStartMs >= windowOutputEnd) {
                    nextWindows.push(win);
                    continue;
                }

                // Calculate the overlap in output time, then convert to source time
                const overlapOutputStart = Math.max(outputStartMs, windowOutputStart);
                const overlapOutputEnd = Math.min(outputEndMs, windowOutputEnd);

                const cutSourceStart = win.startMs + (overlapOutputStart - windowOutputStart) * speed;
                const cutSourceEnd = win.startMs + (overlapOutputEnd - windowOutputStart) * speed;

                // Left portion survives (before the cut)
                if (cutSourceStart > win.startMs) {
                    const leftOutputDuration = (cutSourceStart - win.startMs) / speed;
                    if (leftOutputDuration >= MIN_WINDOW_DURATION_MS) {
                        nextWindows.push({ ...win, endMs: cutSourceStart });
                    }
                }

                // Right portion survives (after the cut)
                if (cutSourceEnd < win.endMs) {
                    const rightOutputDuration = (win.endMs - cutSourceEnd) / speed;
                    if (rightOutputDuration >= MIN_WINDOW_DURATION_MS) {
                        nextWindows.push({
                            id: crypto.randomUUID(),
                            startMs: cutSourceEnd,
                            endMs: win.endMs,
                            speed: win.speed,
                        });
                    }
                }
            }

            // Safety: don't remove all windows
            if (nextWindows.length === 0) {
                console.warn('[cutOutputRange] Cut would remove all windows — aborting');
                return state;
            }

            nextWindows.sort((a, b) => a.startMs - b.startMs);
            return { project: applyNewWindows(state.project, nextWindows) };
        });
    },

});
