
import { create } from 'zustand';
import type { Project, ID, TimeMs } from '../core/types';
import { ProjectImpl } from '../core/project/Project';
import { TimelineImpl } from '../core/timeline/Timeline';

interface ProjectState {
    project: Project;

    // Actions
    loadProject: (project: Project) => void;

    // Timeline Actions
    splitAt: (timeMs: TimeMs, trackId?: ID) => void;
    updateClip: (trackId: ID, clip: import('../core/types').Clip) => void;


    // Playback State (Local to the hook/store, not part of the persistent project really)
    isPlaying: boolean;
    currentTimeMs: TimeMs;

    setIsPlaying: (playing: boolean) => void;
    setCurrentTime: (timeMs: TimeMs) => void;
}

export const useProject = create<ProjectState>((set) => ({
    // Initialize with a default empty project
    project: ProjectImpl.create('Untitled Project'),

    isPlaying: false,
    currentTimeMs: 0,

    loadProject: (project) => set({ project }),

    splitAt: (timeMs, trackId) => set((state) => {
        const newTimeline = TimelineImpl.splitAt(state.project.timeline, timeMs, trackId);
        return {
            project: {
                ...state.project,
                timeline: newTimeline,
                updatedAt: new Date()
            }
        };
    }),

    updateClip: (trackId, clip) => set((state) => {
        try {
            const newTimeline = TimelineImpl.updateClip(state.project.timeline, trackId, clip);
            return {
                project: {
                    ...state.project,
                    timeline: newTimeline,
                    updatedAt: new Date()
                }
            };
        } catch (e) {
            console.error("Failed to update clip:", e);
            return state;
        }
    }),


    setIsPlaying: (isPlaying) => set({ isPlaying }),
    setCurrentTime: (currentTimeMs) => set({ currentTimeMs }),
}));
