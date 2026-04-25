import { create, useStore } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { temporal, type TemporalState } from 'zundo';
import type { Project, ID, UserEvents } from '../../types';
import { ProjectImpl } from '../../core/Project';
import { ProjectStorage } from '../../storage/projectStorage';
import { SyncService } from '../../storage/syncService';
import { useUserStore } from './useUserStore';
import { createWindowSlice, type WindowSlice } from './slices/windowSlice';
import { createSettingsSlice, type SettingsSlice } from './slices/settingsSlice';
import { createZoomSegmentSlice, type ZoomSegmentSlice } from './slices/zoomActionSlice';
import { createSpotlightSlice, type SpotlightSlice } from './slices/spotlightSlice';
import { createTranscriptionSlice, type TranscriptionSlice } from './slices/transcriptionSlice';
import { createCameraMoveSlice, type CameraMoveSlice } from './slices/cameraMoveSlice';
import { createOverlaySlice, type OverlaySlice } from './slices/overlaySlice';


export interface ProjectState extends WindowSlice, SettingsSlice, ZoomSegmentSlice, SpotlightSlice, TranscriptionSlice, CameraMoveSlice, OverlaySlice {
    project: Project;
    /** Recording events — loaded once, never mutated, excluded from undo/redo history. */
    userEvents: UserEvents;
    isSaving: boolean;


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
                userEvents: { mouseClicks: [], mousePositions: [], keyboardEvents: [], drags: [], scrolls: [], typingEvents: [], urlChanges: [], hoveredCards: [] },
                isSaving: false,
                mutedSources: {},

                // Export State
                exportState: { isExporting: false, progress: 0, timeRemainingSeconds: null, phase: undefined },


                // Slices
                ...createWindowSlice(set, get, store),
                ...createSettingsSlice(set, get, store),
                ...createZoomSegmentSlice(set, get, store),
                ...createSpotlightSlice(set, get, store),
                ...createTranscriptionSlice(set, get, store),
                ...createCameraMoveSlice(set, get, store),
                ...createOverlaySlice(set, get, store),

                toggleSourceMute: (sourceId) => set(state => ({
                    mutedSources: {
                        ...state.mutedSources,
                        [sourceId]: !state.mutedSources[sourceId]
                    }
                })),

                loadProject: async (project) => {
                    // Revoke old blob URLs to prevent memory leaks during SPA navigation
                    const prev = get().project;
                    const blobUrls = [
                        prev.screenSource?.runtimeUrl,
                        prev.cameraSource?.runtimeUrl,
                        prev.microphoneSource?.runtimeUrl,
                        prev.settings?.background?.customRuntimeUrl,
                        prev.settings?.audio?.music?.customRuntimeUrl,
                    ];
                    for (const url of blobUrls) {
                        if (url?.startsWith('blob:')) URL.revokeObjectURL(url);
                    }

                    // Separate userEvents from the project so undo/redo history
                    // (via zundo's `partialize`) doesn't snapshot the potentially
                    // massive event arrays on every mutation. Events are immutable
                    // after recording, so they don't need undo/redo tracking.
                    //
                    // After this call:
                    //   s.project        → project WITHOUT userEvents
                    //   s.userEvents     → the extracted events
                    //
                    // Consumers must read events from s.userEvents (or useUserEvents()),
                    // NOT from s.project.userEvents (which will be undefined).
                    // Auto-save re-attaches events before writing to IndexedDB.
                    const { userEvents, ...projectWithoutEvents } = project;

                    // Backfill fields added after initial schema for older projects
                    if (!projectWithoutEvents.timeline.overlaySegments) {
                        projectWithoutEvents.timeline.overlaySegments = [];
                    }
                    // Migration: clear old overlay segments that used items[] arrays
                    // (pre-single-item model). Check for any segment that has 'items' instead of 'item'.
                    projectWithoutEvents.timeline.overlaySegments =
                        projectWithoutEvents.timeline.overlaySegments.filter(
                            (s: any) => s.item && !s.items
                        );
                    if (!projectWithoutEvents.settings.overlay) {
                        projectWithoutEvents.settings.overlay = {
                            enabled: true,
                            defaultDurationMs: 3000,
                            blurDefaults: { blurRadiusPx: 20 },
                            textDefaults: { color: '#454545', backgroundColor: '#ffdb57', fontSizePx: 0 },
                            arrowDefaults: { color: '#7B61FF', strokeWidthPx: 4 },
                            borderDefaults: { color: '#7B61FF', borderWidthPx: 4 },
                        };
                    } else if (projectWithoutEvents.settings.overlay.textDefaults?.color === '#ffffff') {
                        // Migrate old default white to new default colors
                        projectWithoutEvents.settings.overlay.textDefaults.color = '#454545';
                        projectWithoutEvents.settings.overlay.textDefaults.backgroundColor = '#ffdb57';
                    }

                    set({ project: projectWithoutEvents as Project, userEvents });

                    // Clear History so we can't undo into valid empty state or previous project
                    useProjectStore.temporal.getState().clear();
                },

                saveProject: async () => {
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


                    // 2. Copy to project recordings
                    const copyId = `${projectId}-bg-${crypto.randomUUID()}`;
                    await ProjectStorage.saveRecordingBlob(copyId, blob);


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

                    }
                },

                updateProjectName: (name: string) => {
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
                },

            }),
            {
                // Zundo Configuration
                partialize: (state) => ({
                    project: state.project
                }),
                equality: (a, b) => JSON.stringify(a) === JSON.stringify(b), // Deep compare to avoid unnecessary history
                limit: 50 // meaningful limit
            }
        )
    )
);

// --- Auto-Save Subscription ---
// Re-attaches userEvents (stripped on load — see loadProject) before writing
// the full Project record back to IndexedDB. This is the inverse of the
// split performed in loadProject, ensuring the persisted record always
// contains the complete userEvents.
//
// SyncService.saveProject handles both local (IndexedDB) and cloud sync:
//   - Local save: immediate (2s debounce here)
//   - Cloud sync: separate 30s debounce inside SyncService
let saveTimeout: any = null;
useProjectStore.subscribe(
    (state) => state.project,
    (project) => {
        // Debounce save (e.g., 2 seconds)
        if (saveTimeout) clearTimeout(saveTimeout);
        saveTimeout = setTimeout(() => {
            const userEvents = useProjectStore.getState().userEvents;
            const fullProject = { ...project, userEvents };
            // SyncService saves locally first, then queues cloud sync if authenticated
            const { userId, isPro } = useUserStore.getState();
            SyncService.saveProject(fullProject, userId, isPro).catch(console.error);
        }, 2000);
    }
);

// --- Selectors ---

export const useProjectData = () => useProjectStore(s => s.project);
export const useProjectTimeline = () => useProjectStore(s => s.project.timeline);
export const useTimeline = () => useProjectStore(s => s.project.timeline);
export const useUserEvents = () => useProjectStore(s => s.userEvents);
export const useProjectHistory = <T,>(
    selector: (state: TemporalState<{ project: Project }>) => T
) => useStore(useProjectStore.temporal, selector);
