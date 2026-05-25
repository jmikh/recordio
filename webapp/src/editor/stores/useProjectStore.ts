import { create, useStore } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { temporal, type TemporalState } from 'zundo';
import type { Project, ID, UserEvents } from '@shared/types';
import { ProjectImpl } from '../../core/Project';
import { CloudProjectService } from '../../storage/cloudProjectService';
import { CloudStorage } from '../../storage/cloudStorage';
import { captureError } from '../../utils/sentry';
import { BlobCache } from '../../storage/blobCache';
import { useMediaUrlStore } from './useMediaUrlStore';
import { useUserStore } from './useUserStore';
import { useWorkspaceStore } from '../../stores/useWorkspaceStore';
import { createWindowSlice, type WindowSlice } from './slices/windowSlice';
import { createSettingsSlice, type SettingsSlice } from './slices/settingsSlice';
import { createZoomSegmentSlice, type ZoomSegmentSlice } from './slices/zoomActionSlice';
import { createSpotlightSlice, type SpotlightSlice } from './slices/spotlightSlice';
import { createTranscriptionSlice, type TranscriptionSlice } from './slices/transcriptionSlice';
import { createCameraMoveSlice, type CameraMoveSlice } from './slices/cameraMoveSlice';
import { createOverlaySlice, type OverlaySlice } from './slices/overlaySlice';


export interface ProjectState extends WindowSlice, SettingsSlice, ZoomSegmentSlice, SpotlightSlice, TranscriptionSlice, CameraMoveSlice, OverlaySlice {
    project: Project;
    /** Project name — stored as DB column, not in project_data. */
    projectName: string;
    /** Recording events — loaded once, never mutated, excluded from undo/redo history. */
    userEvents: UserEvents;
    isSaving: boolean;


    // Actions
    loadProject: (project: Project, name: string) => Promise<void>;
    saveProject: () => Promise<void>;

    // Background/Music Actions
    /** Select a library asset as the project's custom background */
    selectBackground: (storagePath: string) => Promise<void>;
    /** Clear the current project's custom background */
    clearBackground: () => void;
    /** Select a library asset as the project's custom music */
    selectMusic: (storagePath: string) => Promise<void>;
    /** Clear the current project's custom music */
    clearMusic: () => void;

    // Audio State
    mutedSources: Record<ID, boolean>;
    toggleSourceMute: (sourceId: ID) => void;

    // Settings Actions
    updateProjectName: (name: string) => void;

    // Export Actions
    exportState: import('@shared/export/ExportManager').ExportProgress & { isExporting: boolean };
    setExportState: (state: Partial<import('@shared/export/ExportManager').ExportProgress & { isExporting: boolean }>) => void;


}



export const useProjectStore = create<ProjectState>()(
    subscribeWithSelector(
        temporal(
            (set, get, store) => ({
                // Initialize with a default empty project
                project: ProjectImpl.create(),
                projectName: 'Untitled Project',
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

                loadProject: async (project, name) => {
                    // Note: blob URL cleanup is handled by the caller (App.tsx)
                    // before CloudProjectService.loadProject hydrates new URLs.

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

                    // Backfill settings sub-objects that were added when settings were restructured
                    // from a flat format to nested sub-objects. Projects saved before this change
                    // won't have these keys at all.
                    if (!(projectWithoutEvents.settings as any).screen) {
                        (projectWithoutEvents.settings as any).screen = {
                            mode: 'border',
                            toolbar: { enabled: true, theme: 'light', urlMode: 'short' },
                            padding: 0.02,
                            borderRadiusPx: 12,
                            borderWidthPx: 1,
                            borderColor: '#667eea',
                            deviceFrameId: 'macbook-air-dark',
                            hasShadow: true,
                            hasGlow: false,
                            hasFeather: false,
                            mute: false,
                        };
                    }
                    if (!(projectWithoutEvents.settings as any).background) {
                        (projectWithoutEvents.settings as any).background = {
                            type: 'preset',
                            color: '#6078c4ff',
                            gradientColors: ['#95a6f2ff', '#83689dff'],
                            gradientDirection: 135,
                            colorMode: 'gradient',
                            backgroundBlurPx: 0,
                            imageUrl: 'https://cdn.recordio.io/backgrounds/bg10.avif',
                        };
                    }
                    if (!(projectWithoutEvents.settings as any).zoom) {
                        (projectWithoutEvents.settings as any).zoom = {
                            enabled: true,
                            maxZoom: 2,
                            transitionDurationMs: 750,
                            easing: 'ease-in-out',
                        };
                    }
                    if (!(projectWithoutEvents.settings as any).spotlight) {
                        (projectWithoutEvents.settings as any).spotlight = {
                            enabled: true,
                            dimOpacity: 0.5,
                            enlargeScale: 1.25,
                            transitionDurationMs: 750,
                            minHoldDurationMs: 200,
                            defaultHoldDurationMs: 1000,
                            easing: 'ease-in-out',
                        };
                    }
                    if (!(projectWithoutEvents.settings as any).mouse) {
                        (projectWithoutEvents.settings as any).mouse = {
                            mouseClickEnabled: true,
                            mouseDragEnabled: true,
                            effectType: 'ring',
                            color: '#8b5cf6',
                            size: 1.0,
                            soundEnabled: false,
                            soundVolume: 0.5,
                        };
                    }
                    if (!(projectWithoutEvents.settings as any).keyboard) {
                        (projectWithoutEvents.settings as any).keyboard = {
                            showHotkeys: true,
                            hotkeysSize: 1.0,
                            hotkeysPlacement: 'top',
                            hotkeysMargin: 4,
                        };
                    }
                    if (!(projectWithoutEvents.settings as any).audio) {
                        (projectWithoutEvents.settings as any).audio = {
                            muteMicrophone: false,
                            muteScreenAudio: false,
                            screenVolume: 1,
                            microphoneVolume: 1,
                            music: { enabled: false, source: 'preset', volume: 0.3, fadeOutDurationMs: 3000 },
                        };
                    }

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

                    set({ project: projectWithoutEvents as Project, projectName: name, userEvents });

                    // Clear History so we can't undo into valid empty state or previous project
                    useProjectStore.temporal.getState().clear();
                },

                saveProject: async () => {
                    set({ isSaving: true });
                    try {
                        const { userId } = useUserStore.getState();
                        if (userId) {
                            const userEvents = get().userEvents;
                            const fullProject = { ...get().project, userEvents };
                            await CloudProjectService.saveProject(fullProject, userId);
                        }
                    } catch (e) {
                        captureError(e, { flow: 'project_save', projectId: get().project.id });
                    } finally {
                        set({ isSaving: false });
                    }
                },

                selectBackground: async (storagePath) => {
                    const blobUrl = await BlobCache.getBlobUrl(storagePath);
                    useMediaUrlStore.getState().setUrl(storagePath, blobUrl);

                    get().updateSettings({
                        background: {
                            ...get().project.settings.background,
                            type: 'custom',
                            storagePath,
                            imageUrl: undefined,
                        },
                    });
                },

                clearBackground: () => {
                    get().updateSettings({
                        background: {
                            ...get().project.settings.background,
                            type: 'color',
                            storagePath: undefined,
                        },
                    });
                },

                selectMusic: async (storagePath) => {
                    const blobUrl = await BlobCache.getBlobUrl(storagePath);
                    useMediaUrlStore.getState().setUrl(storagePath, blobUrl);

                    get().updateSettings({
                        audio: {
                            ...get().project.settings.audio,
                            music: {
                                ...get().project.settings.audio.music,
                                source: 'custom',
                                storagePath,
                            },
                        },
                    });
                },

                clearMusic: () => {
                    get().updateSettings({
                        audio: {
                            ...get().project.settings.audio,
                            music: {
                                ...get().project.settings.audio.music,
                                source: 'preset',
                                storagePath: undefined,
                                enabled: false,
                            },
                        },
                    });
                },

                updateProjectName: (name: string) => {
                    set({ projectName: name });
                    // Persist to DB immediately (fire-and-forget, no debounce)
                    const projectId = get().project.id;
                    CloudStorage.updateProjectName(projectId, name).catch(err =>
                        captureError(err, { flow: 'project_rename', projectId })
                    );
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
// Debounces project changes and saves directly to cloud.
// CloudProjectService.saveProject skips no-op writes via SHA-256 hash check.
let saveTimeout: any = null;
useProjectStore.subscribe(
    (state) => state.project,
    (project) => {
        if (saveTimeout) clearTimeout(saveTimeout);
        saveTimeout = setTimeout(() => {
            const { userId } = useUserStore.getState();
            if (!userId) return;
            const userEvents = useProjectStore.getState().userEvents;
            const fullProject = { ...project, userEvents };
            CloudProjectService.saveProject(fullProject, userId).catch(() => { /* saveProject already reports to Sentry */ });
        }, 2000);
    }
);

// --- Selectors ---

export const useProjectName = () => useProjectStore(s => s.projectName);
export const useProjectData = () => useProjectStore(s => s.project);
export const useProjectTimeline = () => useProjectStore(s => s.project.timeline);
export const useTimeline = () => useProjectStore(s => s.project.timeline);
export const useUserEvents = () => useProjectStore(s => s.userEvents);
export const useProjectHistory = <T,>(
    selector: (state: TemporalState<{ project: Project }>) => T
) => useStore(useProjectStore.temporal, selector);
