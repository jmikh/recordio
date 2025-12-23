import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { Project, ID, Recording, OutputWindow } from '../../core/types';
import { ProjectImpl } from '../../core/project/Project';
import { ProjectLibrary } from '../../core/project/ProjectLibrary';

interface ProjectState {
    project: Project;
    isSaving: boolean;

    // Actions
    loadProject: (project: Project) => void;
    saveProject: () => Promise<void>;

    // Timeline Actions
    updateRecording: (updates: Partial<Recording>) => void;
    updateTimeline: (updates: Partial<import('../../core/types').Timeline>) => void;
    addOutputWindow: (window: OutputWindow) => void;
    updateOutputWindow: (id: ID, updates: Partial<OutputWindow>) => void;
    removeOutputWindow: (id: ID) => void;
}

export const useProjectStore = create<ProjectState>()(
    subscribeWithSelector((set, get) => ({
        // Initialize with a default empty project
        // This will likely be overwritten immediately by App.tsx logic loading from IDB
        project: ProjectImpl.create('Untitled Project'),
        isSaving: false,

        loadProject: (project) => set({ project }),

        saveProject: async () => {
            set({ isSaving: true });
            try {
                await ProjectLibrary.saveProject(get().project);
            } catch (e) {
                console.error("Failed to save project:", e);
            } finally {
                set({ isSaving: false });
            }
        },

        updateRecording: (updates) => set((state) => ({
            project: {
                ...state.project,
                timeline: {
                    ...state.project.timeline,
                    recording: {
                        ...state.project.timeline.recording,
                        ...updates
                    }
                },
                updatedAt: new Date()
            }
        })),

        updateTimeline: (updates: Partial<import('../../core/types').Timeline>) => set((state) => ({
            project: {
                ...state.project,
                timeline: {
                    ...state.project.timeline,
                    ...updates
                },
                updatedAt: new Date()
            }
        })),

        addOutputWindow: (window) => set((state) => ({
            project: {
                ...state.project,
                timeline: {
                    ...state.project.timeline,
                    outputWindows: [...state.project.timeline.outputWindows, window].sort((a, b) => a.startMs - b.startMs)
                },
                updatedAt: new Date()
            }
        })),

        updateOutputWindow: (id, updates) => set((state) => ({
            project: {
                ...state.project,
                timeline: {
                    ...state.project.timeline,
                    outputWindows: state.project.timeline.outputWindows
                        .map(w => w.id === id ? { ...w, ...updates } : w)
                        .sort((a, b) => a.startMs - b.startMs)
                },
                updatedAt: new Date()
            }
        })),

        removeOutputWindow: (id) => set((state) => ({
            project: {
                ...state.project,
                timeline: {
                    ...state.project.timeline,
                    outputWindows: state.project.timeline.outputWindows.filter(w => w.id !== id)
                },
                updatedAt: new Date()
            }
        })),


    }))
);

// --- Auto-Save Subscription ---
// We subscribe to the 'project' slice and trigger save.
// In a real app, we should debounce this.
let saveTimeout: any = null;
useProjectStore.subscribe(
    (state) => state.project,
    (project) => {
        // Debounce save (e.g., 2 seconds)
        if (saveTimeout) clearTimeout(saveTimeout);
        saveTimeout = setTimeout(() => {
            console.log('[AutoSave] Saving project...');
            ProjectLibrary.saveProject(project).catch(console.error);
        }, 2000);
    }
);


// --- Selectors ---

export const useProjectData = () => useProjectStore(s => s.project);
export const useProjectTimeline = () => useProjectStore(s => s.project.timeline);
export const useProjectSources = () => useProjectStore(s => s.project.sources);
export const useRecording = () => useProjectStore(s => s.project.timeline.recording);
