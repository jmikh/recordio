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
    userEvents: UserEvents | null; // Single set of loaded events
    isSaving: boolean;

    // Actions
    loadProject: (project: Project) => Promise<void>;
    saveProject: () => Promise<void>;
    addSource: (file: Blob, type: 'image' | 'video' | 'audio') => Promise<ID>;

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
const recalculateAutoZooms = (project: Project, events: UserEvents | null): ViewportMotion[] => {
    if (!project.settings.autoZoom) {
        return project.timeline.recording.viewportMotions; // Return existing if auto is off (or empty?)
    }

    const screenSourceId = project.timeline.recording.screenSourceId;
    const sourceMetadata = project.sources[screenSourceId];

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
                userEvents: null,
                isSaving: false,

                loadProject: async (project) => {
                    console.log('[Action] loadProject', project.id);
                    // 1. Set Project immediately
                    set({ project });

                    // 2. Fetch Events for the screen source
                    let events: UserEvents | null = null;
                    const screenSourceId = project.timeline.recording.screenSourceId;
                    const screenSource = project.sources[screenSourceId];

                    if (screenSource && screenSource.eventsUrl) {
                        try {
                            events = await ProjectStorage.loadEvents(screenSource.eventsUrl);
                        } catch (e) {
                            console.error(`Failed to load events for source ${screenSourceId}`, e);
                            // Initialize empty if failed to avoid crashes
                            events = { mouseClicks: [], keyboardEvents: [], mousePositions: [], drags: [], scrolls: [], typingEvents: [], urlChanges: [] };
                        }
                    }

                    // 3. Update Store
                    set({ userEvents: events });

                    // 4. Clear History so we can't undo into valid empty state or previous project
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

                addSource: async (file, type) => {
                    const uuid = crypto.randomUUID();
                    const sourceId = `src-${uuid}`;
                    const blobId = `rec-${uuid}`;
                    console.log('[Action] addSource', sourceId, type);

                    // 1. Save Blob
                    await ProjectStorage.saveRecordingBlob(blobId, file);

                    // 2. Create Metadata
                    const source: import('../../core/types').SourceMetadata = {
                        id: sourceId,
                        type,
                        url: `recordo-blob://${blobId}`,
                        durationMs: 0,
                        size: { width: 0, height: 0 },
                        hasAudio: false,
                        createdAt: Date.now()
                    };

                    // 3. Extract dimensions if image
                    if (type === 'image') {
                        try {
                            const bitmap = await createImageBitmap(file);
                            source.size = { width: bitmap.width, height: bitmap.height };
                            bitmap.close();
                        } catch (e) {
                            console.warn("Failed to read image dimensions", e);
                        }
                    }

                    // 4. Save Source
                    await ProjectStorage.saveSource(source);

                    // 5. Update State (Hydrate URL)
                    const runtimeSource = { ...source, url: URL.createObjectURL(file) };

                    set((state) => ({
                        project: {
                            ...state.project,
                            sources: {
                                ...state.project.sources,
                                [sourceId]: runtimeSource
                            }
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
                            nextMotions = recalculateAutoZooms(nextProject, state.userEvents);
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
                        const nextMotions = recalculateAutoZooms(tempProject, state.userEvents);

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
                        const nextMotions = recalculateAutoZooms(tempProject, state.userEvents);

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
                        const nextMotions = recalculateAutoZooms(tempProject, state.userEvents);

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
                        const nextMotions = recalculateAutoZooms(tempProject, state.userEvents);

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
export const useProjectSources = () => useProjectStore(s => s.project.sources);
export const useRecording = () => useProjectStore(s => s.project.timeline.recording);
export const useProjectHistory = <T,>(
    selector: (state: TemporalState<{ project: Project }>) => T
) => useStore(useProjectStore.temporal, selector);
