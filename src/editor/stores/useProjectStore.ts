import { create, useStore } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { temporal, type TemporalState } from 'zundo';
import type { Project, ID, Recording, OutputWindow, UserEvents, ViewportMotion, ProjectSettings } from '../../core/types';
import { ProjectImpl } from '../../core/Project';
import { ProjectStorage } from '../../storage/projectStorage';
import { calculateZoomSchedule, ViewMapper } from '../../core/viewportMotion';
import { TimeMapper } from '../../core/timeMapper';

interface ProjectState {
    project: Project;
    sources: Record<ID, import('../../core/types').SourceMetadata>; // Immutable Library
    userEvents: UserEvents | null; // Single set of loaded events
    isSaving: boolean;

    // Actions
    loadProject: (project: Project) => Promise<void>;
    saveProject: () => Promise<void>;
    addSource: (file: Blob, type: 'image' | 'video' | 'audio') => Promise<ID>;
    getSource: (id: ID) => import('../../core/types').SourceMetadata;

    // Timeline Actions
    updateRecording: (updates: Partial<Recording>) => void;
    updateTimeline: (updates: Partial<import('../../core/types').Timeline>) => void;
    addOutputWindow: (window: OutputWindow) => void;
    updateOutputWindow: (id: ID, updates: Partial<OutputWindow>) => void;
    removeOutputWindow: (id: ID) => void;
    splitWindow: (windowId: ID, splitTimeMs: number) => void;

    // Settings Actions
    updateSettings: (settings: Partial<ProjectSettings>) => void;
}

// Helper to recalculate zooms synchronously
const recalculateAutoZooms = (
    project: Project,
    sources: Record<ID, import('../../core/types').SourceMetadata>,
    events: UserEvents | null
): ViewportMotion[] => {
    if (!project.settings.autoZoom) {
        return project.timeline.recording.viewportMotions; // Return existing if auto is off (or empty?)
    }

    const screenSourceId = project.timeline.recording.screenSourceId;
    const sourceMetadata = sources[screenSourceId];

    if (!sourceMetadata || !events) {
        console.warn("Skipping zoom recalc: Missing source or events", screenSourceId);
        return project.timeline.recording.viewportMotions;
    }

    const viewMapper = new ViewMapper(
        sourceMetadata.size,
        project.settings.outputSize,
        project.settings.padding
    );

    const timeMapper = new TimeMapper(project.timeline.recording.timelineOffsetMs, project.timeline.outputWindows);

    return calculateZoomSchedule(
        project.settings.maxZoom,
        viewMapper,
        events,
        timeMapper
    );
};

export const useProjectStore = create<ProjectState>()(
    subscribeWithSelector(
        temporal(
            (set, get) => ({
                // Initialize with a default empty project
                project: ProjectImpl.create('Untitled Project'),
                sources: {},
                userEvents: null,
                isSaving: false,

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
                    let events: UserEvents | null = null;
                    const screenSourceId = project.timeline.recording.screenSourceId;
                    const screenSource = sourcesMap[screenSourceId];

                    if (screenSource && screenSource.eventsUrl) {
                        try {
                            events = await ProjectStorage.loadEvents(screenSource.eventsUrl);
                        } catch (e) {
                            console.error(`Failed to load events for source ${screenSourceId}`, e);
                            // Initialize empty if failed to avoid crashes
                            events = { mouseClicks: [], keyboardEvents: [], mousePositions: [], drags: [], scrolls: [], typingEvents: [], urlChanges: [] };
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

                addSource: async (blob, type, metadata = {}) => {
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

                updateSettings: (updates) => {
                    console.log('[Action] updateSettings', updates);
                    set((state) => {
                        // Optimization: Check if updates actually change anything
                        // Perform shallow comparison
                        const currentSettings = state.project.settings;
                        let hasChanges = false;
                        for (const key in updates) {
                            const val = updates[key as keyof ProjectSettings];
                            if (val !== currentSettings[key as keyof ProjectSettings]) {
                                hasChanges = true;
                                break;
                            }
                        }

                        if (!hasChanges) {
                            return state;
                        }

                        // Flat settings = simple shallow merge!
                        const nextSettings: ProjectSettings = {
                            ...state.project.settings,
                            ...updates
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

                        const paddingChanged = updates.padding !== undefined &&
                            updates.padding !== state.project.settings.padding;

                        // Check for any zoom related changes
                        const zoomChanged = updates.maxZoom !== undefined || updates.autoZoom !== undefined;

                        if (paddingChanged || zoomChanged) {
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

                        // 6. Return new state
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
