import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { Project, ID } from '../../core/types';
import { ProjectImpl } from '../../core/project/project';
import { TimelineImpl } from '../../core/timeline/timeline';
import { calculateZoomSchedule, ViewTransform } from '../../core/effects/viewportMotion';
import { generateMouseEffects } from '../../core/effects/mouseEffects';
import type { ViewportMotion, MouseEffect } from '../../core/types';

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
                    let newProject = {
                        ...state.project,
                        timeline: newTimeline,
                        updatedAt: new Date()
                    };

                    // Recalculate effects because modifying clip boundaries (trimming/moving)
                    // changes which source events are visible and where they appear on the timeline.
                    newProject = recalculateTrackEffects(newProject);

                    return { project: newProject };
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
            onRehydrateStorage: () => (state) => {
                if (state && state.project && !state.project.background) {
                    state.project.background = {
                        type: 'solid',
                        color: '#1e1e1e'
                    };
                }
            }
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

/**
 * Recalculates zoom and mouse effects for the Main Track based on current clips.
 * Should be called whenever clips are split, removed, or updated (trimmed/moved).
 */
function recalculateTrackEffects(project: Project): Project {
    const mainTrack = project.timeline.mainTrack;
    const clips = mainTrack.clips;

    // 1. Collect unique Sources used in this track
    const sourceIds = new Set(clips.map(c => c.sourceId));

    let allMotions: ViewportMotion[] = [];
    let allMouseEffects: MouseEffect[] = [];

    // 2. For each source, calculate effects restricted to the clips using that source
    for (const sourceId of sourceIds) {
        const source = project.sources[sourceId];
        if (!source || !source.events || source.events.length === 0) continue;

        // Get clips for this source
        const sourceClips = clips.filter(c => c.sourceId === sourceId);

        // Reconstruct ViewTransform (needed for Zoom Schedule)
        // We assume track padding settings are constant for now
        const viewTransform = new ViewTransform(
            source.size,
            project.outputSettings.size,
            mainTrack.displaySettings.padding
        );

        // Calculate Effects
        const motions = calculateZoomSchedule(
            mainTrack.displaySettings.maxZoom,
            viewTransform,
            source.events,
            sourceClips
        );

        const mouseEffects = generateMouseEffects(
            source.events,
            sourceClips
        );

        allMotions = allMotions.concat(motions);
        allMouseEffects = allMouseEffects.concat(mouseEffects);
    }

    // 3. Sort Combined Effects by Time
    allMotions.sort((a, b) => a.timeInMs - b.timeInMs);
    allMouseEffects.sort((a, b) => a.timeInMs - b.timeInMs);

    // 4. Update Project with new effects
    return {
        ...project,
        timeline: {
            ...project.timeline,
            mainTrack: {
                ...mainTrack,
                viewportMotions: allMotions,
                mouseEffects: allMouseEffects
            }
        }
    };
}
