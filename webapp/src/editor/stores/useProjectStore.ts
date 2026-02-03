import { create, useStore } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { temporal, type TemporalState } from 'zundo';
import type { Project, ID } from '../../core/types';
import { ProjectImpl } from '../../core/Project';
import { ProjectStorage } from '../../storage/projectStorage';
import { createWindowSlice, type WindowSlice } from './slices/windowSlice';
import { createSettingsSlice, type SettingsSlice } from './slices/settingsSlice';
import { createZoomActionSlice, type ZoomActionSlice } from './slices/zoomActionSlice';
import { createSpotlightSlice, type SpotlightSlice } from './slices/spotlightSlice';
import { createTranscriptionSlice, type TranscriptionSlice } from './slices/transcriptionSlice';


export interface ProjectState extends WindowSlice, SettingsSlice, ZoomActionSlice, SpotlightSlice, TranscriptionSlice {
    project: Project;
    isSaving: boolean;

    // Context Awareness for Undo
    // Stores the UI state at the moment of this history entry
    uiSnapshot?: Partial<import('./useUIStore').UIState>;

    // Actions
    loadProject: (project: Project) => Promise<void>;
    saveProject: () => Promise<void>;

    // Background Library Actions
    /** Upload to global library AND select for current project (copy-on-select) */
    uploadAndSelectBackground: (file: Blob) => Promise<{ libraryId: string; storageUrl: string; runtimeUrl: string }>;
    /** Select an existing library background for current project (copy-on-select) */
    selectBackgroundFromLibrary: (libraryId: string) => Promise<{ libraryId: string; storageUrl: string; runtimeUrl: string }>;
    /** Clear the current project's custom background copy */
    clearProjectBackground: () => Promise<void>;

    // Audio State
    mutedSources: Record<ID, boolean>;
    toggleSourceMute: (sourceId: ID) => void;

    // Settings Actions
    updateProjectName: (name: string) => void;

    // Export Actions
    exportState: import('../export/ExportManager').ExportProgress & { isExporting: boolean };
    setExportState: (state: Partial<import('../export/ExportManager').ExportProgress & { isExporting: boolean }>) => void;
}



export const useProjectStore = create<ProjectState>()(
    subscribeWithSelector(
        temporal(
            (set, get, store) => ({
                // Initialize with a default empty project
                project: ProjectImpl.create('Untitled Project'),
                isSaving: false,
                mutedSources: {},

                // Export State
                exportState: { isExporting: false, progress: 0, timeRemainingSeconds: null },

                // Slices
                ...createWindowSlice(set, get, store),
                ...createSettingsSlice(set, get, store),
                ...createZoomActionSlice(set, get, store),
                ...createSpotlightSlice(set, get, store),
                ...createTranscriptionSlice(set, get, store),

                toggleSourceMute: (sourceId) => set(state => ({
                    mutedSources: {
                        ...state.mutedSources,
                        [sourceId]: !state.mutedSources[sourceId]
                    }
                })),

                loadProject: async (project) => {
                    console.log('[Action] loadProject', project.id);

                    // Project now contains embedded sources and events - no separate loading needed
                    set({ project });

                    // Clear History so we can't undo into valid empty state or previous project
                    useProjectStore.temporal.getState().clear();
                },

                saveProject: async () => {
                    console.log('[Action] saveProject');
                    set({ isSaving: true });
                    try {
                        await ProjectStorage.saveProject(get().project);
                    } catch (e) {
                        console.error("Failed to save project:", e);
                    } finally {
                        set({ isSaving: false });
                    }
                },

                uploadAndSelectBackground: async (blob) => {
                    const state = get();
                    const projectId = state.project.id;

                    // 1. Save to global library
                    const libraryId = await ProjectStorage.saveCustomBackground(blob);
                    console.log(`[Store] Added to library: ${libraryId}`);

                    // 2. Copy to project recordings
                    const copyId = `${projectId}-bg-${crypto.randomUUID()}`;
                    await ProjectStorage.saveRecordingBlob(copyId, blob);
                    console.log(`[Store] Created project copy: ${copyId}`);

                    // 3. Create URLs
                    const storageUrl = `recordio-blob://${copyId}`;
                    const runtimeUrl = URL.createObjectURL(blob);

                    return { libraryId, storageUrl, runtimeUrl };
                },

                selectBackgroundFromLibrary: async (libraryId) => {
                    const state = get();
                    const projectId = state.project.id;

                    // 1. Get blob from library
                    const blob = await ProjectStorage.getCustomBackground(libraryId);
                    if (!blob) {
                        throw new Error(`Background ${libraryId} not found in library`);
                    }

                    // 2. Copy to project recordings
                    const copyId = `${projectId}-bg-${crypto.randomUUID()}`;
                    await ProjectStorage.saveRecordingBlob(copyId, blob);
                    console.log(`[Store] Created project copy: ${copyId}`);

                    // 3. Create URLs
                    const storageUrl = `recordio-blob://${copyId}`;
                    const runtimeUrl = URL.createObjectURL(blob);

                    return { libraryId, storageUrl, runtimeUrl };
                },

                clearProjectBackground: async () => {
                    const state = get();
                    const currentUrl = state.project.settings.background.customStorageUrl;

                    if (currentUrl?.startsWith('recordio-blob://')) {
                        const blobId = currentUrl.replace('recordio-blob://', '');
                        await ProjectStorage.deleteRecordingBlob(blobId);
                        console.log(`[Store] Deleted project background copy: ${blobId}`);
                    }
                },

                updateProjectName: (name: string) => {
                    console.log('[Action] updateProjectName', name);
                    set((state) => ({
                        project: {
                            ...state.project,
                            name,
                            updatedAt: new Date()
                        }
                    }));
                },

                setExportState: (updates) => {
                    set(state => ({
                        exportState: { ...state.exportState, ...updates }
                    }));
                }
            }),
            {
                // Zundo Configuration
                partialize: (state) => ({
                    project: state.project,
                    uiSnapshot: state.uiSnapshot
                }),
                equality: (a, b) => JSON.stringify(a) === JSON.stringify(b), // Deep compare to avoid unnecessary history
                limit: 50 // meaningful limit
            }
        )
    )
);

// --- Auto-Save Subscription ---
let saveTimeout: any = null;
useProjectStore.subscribe(
    (state) => state.project,
    (project) => {
        // Debounce save (e.g., 2 seconds)
        if (saveTimeout) clearTimeout(saveTimeout);
        saveTimeout = setTimeout(() => {
            console.log('[AutoSave] Saving project...');
            ProjectStorage.saveProject(project).catch(console.error);
        }, 2000);
    }
);

// --- Selectors ---

export const useProjectData = () => useProjectStore(s => s.project);
export const useProjectTimeline = () => useProjectStore(s => s.project.timeline);
export const useTimeline = () => useProjectStore(s => s.project.timeline);
export const useUserEvents = () => useProjectStore(s => s.project.userEvents);
export const useProjectHistory = <T,>(
    selector: (state: TemporalState<{ project: Project; uiSnapshot?: Partial<import('./useProjectStore').ProjectState['uiSnapshot']> }>) => T
) => useStore(useProjectStore.temporal, selector);
