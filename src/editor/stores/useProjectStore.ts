import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { Project, ID } from '../../core/types';
import { ProjectImpl } from '../../core/project/project';
import { TimelineImpl } from '../../core/timeline/timeline';

interface ProjectState {
    project: Project;

    // Actions
    loadProject: (project: Project) => void;
    // We can add granular setters here later (e.g. setMaxZoom) to avoid replacing whole project
    setMaxZoom: (maxZoom: number) => void;

    // Timeline Actions
    splitAt: (timeMs: number) => void;
    updateClip: (trackId: ID, clip: import('../../core/types').Clip) => void;
    updateSource: (sourceId: ID, updates: Partial<import('../../core/types').Source>) => void;
}

export const useProjectStore = create<ProjectState>()(
    persist(
        (set) => ({
            // Initialize with a default empty project
            project: ProjectImpl.create('Untitled Project'),

            loadProject: (project) => set({ project }),

            setMaxZoom: (maxZoom) => set((state) => ({
                project: {
                    ...state.project,
                    timeline: {
                        ...state.project.timeline,
                        mainTrack: {
                            ...state.project.timeline.mainTrack,
                            displaySettings: {
                                ...state.project.timeline.mainTrack.displaySettings,
                                maxZoom
                            }
                        }
                    },
                    updatedAt: new Date()
                }
            })),

            splitAt: (timeMs) => set((state) => {
                const newTimeline = TimelineImpl.splitAt(state.project.timeline, timeMs);
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

            updateSource: (sourceId, updates) => set((state) => ({
                project: ProjectImpl.updateSource(state.project, sourceId, updates)
            })),
        }),
        {
            name: 'recordo-project-storage', // name of the item in the storage (must be unique)
            storage: createJSONStorage(() => localStorage),
            partialize: (state) => ({ project: state.project }), // Only persist the project
        }
    )
);

// --- Selectors ---
// Explicit strongly typed selectors to prevent re-renders

export const useProjectData = () => useProjectStore(s => s.project);
export const useMaxZoom = () => useProjectStore(s => s.project.timeline.mainTrack.displaySettings.maxZoom);
export const useProjectDisplaySettings = () => useProjectStore(s => s.project.timeline.mainTrack.displaySettings);
export const useProjectTimeline = () => useProjectStore(s => s.project.timeline);
export const useProjectSources = () => useProjectStore(s => s.project.sources);
