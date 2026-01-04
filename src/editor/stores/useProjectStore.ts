import { create, useStore } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { temporal, type TemporalState } from 'zundo';
import type { Project, ID, Recording, OutputWindow, UserEvents, ViewportMotion, ProjectSettings } from '../../core/types';
import { ProjectImpl } from '../../core/Project';
import { ProjectStorage } from '../../storage/projectStorage';
import { calculateZoomSchedule, ViewMapper } from '../../core/viewportMotion';
import { TimeMapper } from '../../core/timeMapper';

const EMPTY_USER_EVENTS: UserEvents = {
    mouseClicks: [],
    mousePositions: [],
    keyboardEvents: [],
    drags: [],
    scrolls: [],
    typingEvents: [],
    urlChanges: []
};


export const CanvasMode = {
    Preview: 'preview',
    Crop: 'crop',
    Camera: 'camera',
    Zoom: 'zoom'
} as const;
export type CanvasMode = typeof CanvasMode[keyof typeof CanvasMode];

export interface ProjectState {
    project: Project;
    sources: Record<ID, import('../../core/types').SourceMetadata>; // Immutable Library
    userEvents: UserEvents; // Single set of loaded events (Never null)
    isSaving: boolean;

    // Canvas Mode State
    canvasMode: CanvasMode;
    activeZoomId: ID | null;
    editingZoomInitialState: ViewportMotion | null;
    selectedWindowId: ID | null;

    // Actions
    loadProject: (project: Project) => Promise<void>;
    saveProject: () => Promise<void>;
    addSource: (file: Blob, type: 'image' | 'video' | 'audio', metadata?: Partial<import('../../core/types').SourceMetadata>) => Promise<ID>;
    getSource: (id: ID) => import('../../core/types').SourceMetadata;
    setCanvasMode: (mode: CanvasMode) => void;
    selectWindow: (id: ID | null) => void;

    // Audio State
    mutedSources: Record<ID, boolean>;
    toggleSourceMute: (sourceId: ID) => void;

    // Zoom Editing Actions
    setEditingZoom: (id: ID | null) => void;
    updateViewportMotion: (id: ID, motion: Partial<ViewportMotion>) => void;
    addViewportMotion: (motion: ViewportMotion) => void;
    deleteViewportMotion: (id: ID) => void;

    // Timeline Actions
    updateRecording: (updates: Partial<Recording>) => void;
    updateTimeline: (updates: Partial<import('../../core/types').Timeline>) => void;
    addOutputWindow: (window: OutputWindow) => void;
    updateOutputWindow: (id: ID, updates: Partial<OutputWindow>) => void;
    removeOutputWindow: (id: ID) => void;
    splitWindow: (windowId: ID, splitTimeMs: number) => void;

    // Settings Actions
    updateSettings: (settings: DeepPartial<ProjectSettings>) => void;
    updateProjectName: (name: string) => void;
}

// Optimization helper
type DeepPartial<T> = {
    [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

// Helper to recalculate zooms synchronously
const recalculateAutoZooms = (
    project: Project,
    sources: Record<ID, import('../../core/types').SourceMetadata>,
    events: UserEvents
): ViewportMotion[] => {
    // 1. If Auto Zoom is ON, regenerate completely
    if (project.settings.zoom.autoZoom) {
        const screenSourceId = project.timeline.recording.screenSourceId;
        const sourceMetadata = sources[screenSourceId];

        if (!sourceMetadata) {
            console.warn("Skipping zoom recalc: Missing source or events", screenSourceId);
            return project.timeline.recording.viewportMotions;
        }

        const viewMapper = new ViewMapper(
            sourceMetadata.size,
            project.settings.outputSize,
            project.settings.screen.padding,
            project.settings.screen.crop
        );

        const timeMapper = new TimeMapper(project.timeline.recording.timelineOffsetMs, project.timeline.outputWindows);

        return calculateZoomSchedule(
            project.settings.zoom.maxZoom,
            project.settings.zoom.defaultDurationMs,
            viewMapper,
            events,
            timeMapper
        );
    }

    // 2. If Auto Zoom is OFF, cleanup invalid/gap zooms
    // We filter out any zooms whose "target time" (sourceEndTimeMs) falls into a gap in the (new) windows.
    const timeMapper = new TimeMapper(project.timeline.recording.timelineOffsetMs, project.timeline.outputWindows);
    const currentMotions = project.timeline.recording.viewportMotions || [];

    return currentMotions.filter(m => {
        const outputTime = timeMapper.mapSourceToOutputTime(m.sourceEndTimeMs);
        return outputTime !== -1;
    });
};

export const useProjectStore = create<ProjectState>()(
    subscribeWithSelector(
        temporal(
            (set, get) => ({
                // Initialize with a default empty project
                project: ProjectImpl.create('Untitled Project'),
                sources: {},
                userEvents: EMPTY_USER_EVENTS,
                isSaving: false,
                mutedSources: {},

                // Canvas Mode Logic
                canvasMode: CanvasMode.Preview,
                activeZoomId: null,
                editingZoomInitialState: null as ViewportMotion | null,
                selectedWindowId: null,

                selectWindow: (id) => set({
                    selectedWindowId: id,
                    ...(id ? { activeZoomId: null, canvasMode: CanvasMode.Preview } : {})
                }),

                setCanvasMode: (mode) => set({
                    canvasMode: mode,
                    ...(mode !== CanvasMode.Zoom ? { activeZoomId: null, editingZoomInitialState: null } : {}),
                    // If triggering a mode change (except purely Preview potentially?), deselect window.
                    // But usually returning to Preview shouldn't necessarily deselect window? 
                    // User wanted strict "One Active". 
                    // If mode is NOT Preview (e.g. Crop, Camera), deselect window.
                    ...(mode !== CanvasMode.Preview ? { selectedWindowId: null } : {})
                }),

                toggleSourceMute: (sourceId) => set(state => ({
                    mutedSources: {
                        ...state.mutedSources,
                        [sourceId]: !state.mutedSources[sourceId]
                    }
                })),

                setEditingZoom: (id) => {
                    const store = useProjectStore;
                    const state = get(); // Use if needed

                    if (id) {
                        console.log('[Action] setEditingZoom START', id);

                        // 1. Capture Initial State
                        const motion = state.project.timeline.recording.viewportMotions.find(m => m.id === id);
                        if (motion) {
                            set({ editingZoomInitialState: { ...motion } });
                        }

                        // 2. Pause History
                        store.temporal.getState().pause();

                        // 3. Set Mode
                        set({ canvasMode: CanvasMode.Zoom, activeZoomId: id });

                    } else {
                        console.log('[Action] setEditingZoom END (Commit)');
                        const editingId = state.activeZoomId;
                        const initial = state.editingZoomInitialState;
                        const currentFunctions = get(); // Fresh getters

                        if (editingId && initial) {
                            const currentMotion = state.project.timeline.recording.viewportMotions.find(m => m.id === editingId);

                            if (currentMotion) {
                                // A. Revert to Initial (While Paused) so Zundo sees "No Change" effectively? 
                                //    Wait, Zundo paused means it ignored the intermediate changes.
                                //    So the "Current State" in Zundo's eyes is effectively "Unknown" or "Last Snapshot".
                                //    If we Resume now, Zundo will take a snapshot of the *Current State* as the *New Head*?
                                //    No, Zundo usually snapshots on *change*.

                                //    If we Resume, and then Change, it diffs Current vs New.
                                //    But "Current" is already the Moved State.

                                //    So we MUST:
                                //    1. Revert to Initial (While Paused).
                                //    2. Resume.
                                //    3. Set to Final.

                                // Revert
                                currentFunctions.updateViewportMotion(editingId, initial);

                                // Resume
                                store.temporal.getState().resume();

                                // Apply Final (This triggers the history entry)
                                // We need to do this in a setTimeout or just next line? Synchronous should work if Zundo subscribes synchronously.
                                // However, we are inside a `set` or action scope.
                                // Let's try synchronous.
                                currentFunctions.updateViewportMotion(editingId, currentMotion);
                            } else {
                                store.temporal.getState().resume();
                            }
                        } else {
                            store.temporal.getState().resume();
                        }

                        // Cleanup
                        set({ editingZoomInitialState: null, canvasMode: CanvasMode.Preview });
                    }

                    set({ activeZoomId: id, selectedWindowId: null });
                },

                updateViewportMotion: (id, updates) => {
                    console.log('[Action] updateViewportMotion', id, updates);
                    set(state => {
                        const motions = state.project.timeline.recording.viewportMotions;
                        const idx = motions.findIndex(m => m.id === id);
                        if (idx === -1) return state;

                        const nextMotions = [...motions];
                        nextMotions[idx] = { ...nextMotions[idx], ...updates };

                        // FORCE AUTO ZOOM OFF if it was on
                        // This prevents recalc from overwriting our manual work
                        const nextSettings = {
                            ...state.project.settings,
                            zoom: { ...state.project.settings.zoom, autoZoom: false }
                        };

                        return {
                            project: {
                                ...state.project,
                                settings: nextSettings,
                                timeline: {
                                    ...state.project.timeline,
                                    recording: {
                                        ...state.project.timeline.recording,
                                        viewportMotions: nextMotions
                                    }
                                }
                            }
                        };
                    });
                },

                addViewportMotion: (motion) => {
                    console.log('[Action] addViewportMotion', motion);
                    set(state => {
                        const motions = [...state.project.timeline.recording.viewportMotions, motion];

                        const nextSettings = {
                            ...state.project.settings,
                            zoom: { ...state.project.settings.zoom, autoZoom: false }
                        };

                        return {
                            project: {
                                ...state.project,
                                settings: nextSettings,
                                timeline: {
                                    ...state.project.timeline,
                                    recording: {
                                        ...state.project.timeline.recording,
                                        viewportMotions: motions
                                    }
                                }
                            }
                        };
                    });
                },

                deleteViewportMotion: (id) => {
                    console.log('[Action] deleteViewportMotion', id);
                    set(state => {
                        const motions = state.project.timeline.recording.viewportMotions.filter(m => m.id !== id);

                        const nextSettings = {
                            ...state.project.settings,
                            zoom: { ...state.project.settings.zoom, autoZoom: false }
                        };

                        return {
                            project: {
                                ...state.project,
                                settings: nextSettings,
                                timeline: {
                                    ...state.project.timeline,
                                    recording: {
                                        ...state.project.timeline.recording,
                                        viewportMotions: motions
                                    }
                                }
                            }
                        };
                    });
                    // Also ensure we exit edit mode if we deleted the active one
                    const currentEdit = get().activeZoomId;
                    if (currentEdit === id) {
                        get().setEditingZoom(null);
                    }
                },

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
                    const screenSourceId = project.timeline.recording.screenSourceId;
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
                        url: `recordo-blob://${blobId}`, // Internal protocol
                        createdAt: Date.now(),
                        fileSizeBytes: blob.size,
                        durationMs: 0,
                        size: { width: 0, height: 0 },
                        hasAudio: false,
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

                updateRecording: (updates) => {
                    console.log('[Action] updateRecording', updates);
                    set((state) => ({
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
                    }));
                },

                updateTimeline: (updates) => {
                    console.log('[Action] updateTimeline', updates);
                    set((state) => ({
                        project: {
                            ...state.project,
                            timeline: {
                                ...state.project.timeline,
                                ...updates
                            },
                            updatedAt: new Date()
                        }
                    }));
                },

                updateSettings: (updates: any) => {
                    console.log('[Action] updateSettings', updates);
                    set((state) => {
                        const currentSettings = state.project.settings;

                        // Deep merge known nested objects
                        // We use the existing setting as base, and merge updates on top
                        // This handles both "full object replacement" (if spread by caller) and "partial update"

                        const nextSettings: ProjectSettings = {
                            ...currentSettings,
                            ...updates,
                            // Specialized deep merges for nested objects
                            background: {
                                ...currentSettings.background,
                                ...(updates.background || {})
                            },
                            screen: {
                                ...currentSettings.screen,
                                ...(updates.screen || {})
                            },
                            zoom: {
                                ...currentSettings.zoom,
                                ...(updates.zoom || {})
                            },
                            camera: {
                                ...currentSettings.camera,
                                ...(updates.camera || {})
                            },
                            // OutputSize is a simple object, can be merged deeply too
                            outputSize: {
                                ...currentSettings.outputSize,
                                ...(updates.outputSize || {})
                            }
                        };

                        const nextProject = {
                            ...state.project,
                            settings: nextSettings,
                            updatedAt: new Date()
                        };

                        // Recalculate Zooms if necessary conditions met
                        // 1. Zoom settings changed
                        // 2. Padding changed
                        let nextMotions = state.project.timeline.recording.viewportMotions;

                        // Check padding inside the now-merged settings or from updates
                        // Using merged settings is safer
                        const paddingChanged = nextSettings.screen.padding !== currentSettings.screen.padding;

                        // Check for any zoom related changes
                        const zoomUpdates = updates.zoom || {};
                        const zoomChanged = zoomUpdates.maxZoom !== undefined || zoomUpdates.autoZoom !== undefined;

                        // Check for output size changes
                        const sizeChanged = nextSettings.outputSize.width !== currentSettings.outputSize.width ||
                            nextSettings.outputSize.height !== currentSettings.outputSize.height;

                        if (paddingChanged || zoomChanged || sizeChanged) {
                            nextMotions = recalculateAutoZooms(nextProject, state.sources, state.userEvents);
                        }

                        return {
                            project: {
                                ...nextProject,
                                timeline: {
                                    ...nextProject.timeline,
                                    recording: {
                                        ...nextProject.timeline.recording,
                                        viewportMotions: nextMotions
                                    }
                                }
                            }
                        };
                    });
                },

                addOutputWindow: (window) => {
                    console.log('[Action] addOutputWindow', window);
                    set((state) => {
                        const nextOutputWindows = [...state.project.timeline.outputWindows, window].sort((a, b) => a.startMs - b.startMs);

                        // Temporary project state to calculate zooms
                        const tempProject = {
                            ...state.project,
                            timeline: {
                                ...state.project.timeline,
                                outputWindows: nextOutputWindows
                            }
                        };
                        const nextMotions = recalculateAutoZooms(tempProject, state.sources, state.userEvents);

                        return {
                            project: {
                                ...tempProject,
                                timeline: {
                                    ...tempProject.timeline,
                                    recording: {
                                        ...tempProject.timeline.recording,
                                        viewportMotions: nextMotions
                                    }
                                },
                                updatedAt: new Date()
                            }
                        };
                    });
                },

                updateOutputWindow: (id, updates) => {
                    console.log('[Action] updateOutputWindow', id, updates);
                    set((state) => {
                        const nextOutputWindows = state.project.timeline.outputWindows
                            .map(w => w.id === id ? { ...w, ...updates } : w)
                            .sort((a, b) => a.startMs - b.startMs);

                        const tempProject = {
                            ...state.project,
                            timeline: {
                                ...state.project.timeline,
                                outputWindows: nextOutputWindows
                            }
                        };
                        const nextMotions = recalculateAutoZooms(tempProject, state.sources, state.userEvents);

                        return {
                            project: {
                                ...tempProject,
                                timeline: {
                                    ...tempProject.timeline,
                                    recording: {
                                        ...tempProject.timeline.recording,
                                        viewportMotions: nextMotions
                                    }
                                },
                                updatedAt: new Date()
                            }
                        };
                    });
                },

                removeOutputWindow: (id) => {
                    console.log('[Action] removeOutputWindow', id);
                    set((state) => {
                        const nextOutputWindows = state.project.timeline.outputWindows.filter(w => w.id !== id);

                        const tempProject = {
                            ...state.project,
                            timeline: {
                                ...state.project.timeline,
                                outputWindows: nextOutputWindows
                            }
                        };
                        const nextMotions = recalculateAutoZooms(tempProject, state.sources, state.userEvents);

                        // Clear selection if deleted
                        const nextSelected = state.selectedWindowId === id ? null : state.selectedWindowId;

                        return {
                            selectedWindowId: nextSelected,
                            project: {
                                ...tempProject,
                                timeline: {
                                    ...tempProject.timeline,
                                    recording: {
                                        ...tempProject.timeline.recording,
                                        viewportMotions: nextMotions
                                    }
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
                        if (windowIndex === -1) return state; // No-op if not found

                        const originalWin = state.project.timeline.outputWindows[windowIndex];

                        // 2. Shrink original window
                        const shrunkWin = { ...originalWin, endMs: splitTimeMs };

                        // 3. Create new window
                        // We need a way to generate IDs safely. Using randomUUID for now.
                        const newWin: OutputWindow = {
                            id: crypto.randomUUID(),
                            startMs: splitTimeMs,
                            endMs: originalWin.endMs
                        };

                        // 4. Construct new window list
                        // We replace the original with shrunk, and append the new one.
                        // Then sort.
                        let nextOutputWindows = [...state.project.timeline.outputWindows];
                        nextOutputWindows[windowIndex] = shrunkWin;
                        nextOutputWindows.push(newWin);
                        nextOutputWindows.sort((a, b) => a.startMs - b.startMs);

                        // 5. Recalculate Zooms (Atomic!)
                        const tempProject = {
                            ...state.project,
                            timeline: {
                                ...state.project.timeline,
                                outputWindows: nextOutputWindows
                            }
                        };
                        const nextMotions = recalculateAutoZooms(tempProject, state.sources, state.userEvents);

                        return {
                            project: {
                                ...tempProject,
                                timeline: {
                                    ...tempProject.timeline,
                                    recording: {
                                        ...tempProject.timeline.recording,
                                        viewportMotions: nextMotions
                                    }
                                },
                                updatedAt: new Date()
                            }
                        };
                    });
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
export const useRecording = () => useProjectStore(s => s.project.timeline.recording);
export const useProjectHistory = <T,>(
    selector: (state: TemporalState<{ project: Project }>) => T
) => useStore(useProjectStore.temporal, selector);
