import { create, useStore } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { temporal, type TemporalState } from 'zundo';
import type { Project, ID, UserEvents } from '../../core/types';
import { ProjectImpl } from '../../core/Project';
import { ProjectStorage } from '../../storage/projectStorage';
import { createWindowSlice, type WindowSlice } from './slices/windowSlice';
import { createSettingsSlice, type SettingsSlice } from './slices/settingsSlice';
import { createViewportMotionSlice, type ViewportMotionSlice } from './slices/viewportMotionSlice';
import { createTranscriptionSlice, type TranscriptionSlice } from './slices/transcriptionSlice';

const EMPTY_USER_EVENTS: UserEvents = {
    mouseClicks: [],
    mousePositions: [],
    keyboardEvents: [],
    drags: [],
    scrolls: [],
    typingEvents: [],
    urlChanges: []
};


export interface ProjectState extends WindowSlice, SettingsSlice, ViewportMotionSlice, TranscriptionSlice {
    project: Project;
    sources: Record<ID, import('../../core/types').SourceMetadata>; // Immutable Library
    userEvents: UserEvents; // Single set of loaded events (Never null)
    isSaving: boolean;

    // Context Awareness for Undo
    // Stores the UI state at the moment of this history entry
    uiSnapshot?: Partial<import('./useUIStore').UIState>;

    // Actions
    loadProject: (project: Project) => Promise<void>;
    saveProject: () => Promise<void>;
    addSource: (file: Blob, type: 'image' | 'video' | 'audio', metadata?: Partial<import('../../core/types').SourceMetadata>) => Promise<ID>;
    getSource: (id: ID) => import('../../core/types').SourceMetadata;

    // Audio State
    mutedSources: Record<ID, boolean>;
    toggleSourceMute: (sourceId: ID) => void;

    // Zoom Actions
    // (Moved to ViewportMotionSlice)

    // Timeline Actions


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
                sources: {},
                userEvents: EMPTY_USER_EVENTS,
                isSaving: false,
                mutedSources: {},

                // Export State
                exportState: { isExporting: false, progress: 0, timeRemainingSeconds: null },

                // Slices
                ...createWindowSlice(set, get, store),
                ...createSettingsSlice(set, get, store),
                ...createViewportMotionSlice(set, get, store),
                ...createTranscriptionSlice(set, get, store),

                toggleSourceMute: (sourceId) => set(state => ({
                    mutedSources: {
                        ...state.mutedSources,
                        [sourceId]: !state.mutedSources[sourceId]
                    }
                })),

                // Viewport motions moved to slice

                loadProject: async (project) => {
                    console.log('[Action] loadProject', project.id);

                    // 1. Load Sources (Separately)
                    const sourcesMap: Record<ID, import('../../core/types').SourceMetadata> = {};
                    const sourceIds = ProjectImpl.getReferencedSourceIds(project);
                    await Promise.all(sourceIds.map(async (id) => {
                        const source = await ProjectStorage.loadSource(id);
                        if (source) {
                            sourcesMap[id] = source;
                        } else {
                            console.warn(`[loadProject] Source ${id} not found in DB.`);
                        }
                    }));

                    // 2. Set Sources FIRST (so project consumers find them)
                    set({ sources: sourcesMap });

                    // 3. Set Project
                    set({ project });

                    // 4. Fetch Events for the screen source
                    let events: UserEvents = EMPTY_USER_EVENTS;
                    const screenSourceId = project.timeline.screenSourceId;
                    const screenSource = sourcesMap[screenSourceId];

                    if (screenSource && screenSource.eventsUrl) {
                        try {
                            const loaded = await ProjectStorage.loadEvents(screenSource.eventsUrl);
                            if (loaded) events = loaded;
                        } catch (e) {
                            console.error(`Failed to load events for source ${screenSourceId}`, e);
                        }
                    }

                    // 5. Update Store with Events
                    set({ userEvents: events });

                    // 6. Clear History so we can't undo into valid empty state or previous project
                    useProjectStore.temporal.getState().clear();
                },

                getSource: (id) => {
                    const s = get().sources[id];
                    if (!s) throw new Error(`Source with ID ${id} not found.`);
                    return s;
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

                addSource: async (blob, type, metadata: Partial<import('../../core/types').SourceMetadata> = {}) => {
                    const state = get();
                    const projectId = state.project.id;
                    const uuid = crypto.randomUUID();

                    // ID Strategy: {projectId}-src-{uuid}
                    // ID Strategy: {projectId}-rec-{uuid} (for blob)
                    const sourceId = `${projectId}-src-${uuid}`;
                    const blobId = `${projectId}-rec-${uuid}`;

                    console.log(`[Store] Adding Source: ${sourceId} (${type})`);

                    // 1. Save Blob (Heavy)
                    await ProjectStorage.saveRecordingBlob(blobId, blob);

                    // 2. Create Source Metadata (Light)
                    const newSource: import('../../core/types').SourceMetadata = {
                        id: sourceId,
                        type,
                        url: `recordio-blob://${blobId}`, // Internal protocol
                        createdAt: Date.now(),
                        fileSizeBytes: blob.size,
                        durationMs: 0,
                        size: { width: 0, height: 0 },
                        hasAudio: false,
                        has_microphone: false, // Default to false for manually added sources
                        name: metadata.name || 'Untitled Source',
                        ...metadata
                    };

                    // 3. Save Source to DB
                    await ProjectStorage.saveSource(newSource);

                    // 4. Update Store (State)
                    // We need to hydrate the URL for immediate playback in the session
                    const hydratedSource = { ...newSource, url: URL.createObjectURL(blob) };

                    set((state) => ({
                        sources: {
                            ...state.sources,
                            [sourceId]: hydratedSource
                        },
                        project: {
                            ...state.project,
                            updatedAt: new Date()
                        }
                    }));

                    return sourceId;
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
export const useProjectSources = () => useProjectStore(s => s.sources);
export const useTimeline = () => useProjectStore(s => s.project.timeline);
export const useProjectHistory = <T,>(
    selector: (state: TemporalState<{ project: Project; uiSnapshot?: Partial<import('./useProjectStore').ProjectState['uiSnapshot']> }>) => T
) => useStore(useProjectStore.temporal, selector);
