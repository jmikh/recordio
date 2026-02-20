
import { create } from 'zustand';
import type { ID, TimeMs, Size } from '../../types';
import { useProjectStore } from './useProjectStore';

export interface TrackVisibility {
    recording: boolean;
    zoom: boolean;
    spotlight: boolean;
    captions: boolean;
}

const DEFAULT_TRACK_VISIBILITY: TrackVisibility = {
    recording: true,
    zoom: true,
    spotlight: true,
    captions: false,
};

export const CanvasMode = {
    Preview: 'preview',
    CropEdit: 'cropEdit',
    CameraEdit: 'cameraEdit',
    ZoomEdit: 'zoomEdit',
    SpotlightEdit: 'spotlightEdit',
    CaptionEdit: 'captionEdit',
} as const;
export type CanvasMode = typeof CanvasMode[keyof typeof CanvasMode];

export const SettingsPanel = {
    Project: 'project',
    Screen: 'screen',
    Camera: 'camera',
    Export: 'export',
} as const;
export type SettingsPanel = typeof SettingsPanel[keyof typeof SettingsPanel];

export type SettingsPanelTab = 'project' | 'screen' | 'effects' | 'background' | 'camera' | 'captions' | 'audio';

export interface UIState {
    canvasMode: CanvasMode;
    selectedZoomId: ID | null;
    selectedSpotlightId: ID | null;
    selectedWindowId: ID | null;
    selectedCaptionId: ID | null;
    selectedSettingsPanel: SettingsPanel;
    isResizingWindow: boolean;

    setCanvasMode: (mode: Exclude<CanvasMode, typeof CanvasMode.ZoomEdit | typeof CanvasMode.SpotlightEdit>) => void;
    setIsResizingWindow: (isResizing: boolean) => void;
    selectWindow: (id: ID | null) => void;
    selectZoom: (id: ID | null) => void;
    selectSpotlight: (id: ID | null) => void;
    selectCaption: (id: ID | null) => void;
    deselectAllSegments: () => void;
    setSettingsPanel: (panel: SettingsPanel) => void;

    // Settings Panel Active Tab (lifted from SettingsPanel local state)
    settingsPanelActiveTab: SettingsPanelTab;
    setSettingsPanelActiveTab: (tab: SettingsPanelTab) => void;

    // Timeline State
    timelineContainerRef: React.RefObject<HTMLDivElement | null> | null;
    setTimelineContainerRef: (ref: React.RefObject<HTMLDivElement | null> | null) => void;
    pixelsPerSec: number;
    setPixelsPerSec: (pps: number) => void;

    // Canvas Container Size (for DisplayMapper)
    canvasContainerSize: Size;
    setCanvasContainerSize: (size: Size) => void;

    // Playback State
    isPlaying: boolean;
    currentTimeMs: TimeMs;
    previewTimeMs: TimeMs | null;

    // Performance Monitoring
    // fps: number;
    // frameTime: number;
    // setFps: (fps: number) => void;
    // setFrameTime: (ms: number) => void;

    setIsPlaying: (playing: boolean) => void;
    setCurrentTime: (timeMs: TimeMs) => void;
    setPreviewTime: (timeMs: TimeMs | null) => void;

    // Debug Bar
    showDebugBar: boolean;
    toggleDebugBar: () => void;

    // Debug Overlays (focus areas on canvas)
    showDebugOverlays: boolean;
    toggleDebugOverlays: () => void;

    // Collapsible Card Visibility
    // -- Effects Settings
    showCollapsibleEffects: boolean;
    showCollapsibleMouse: boolean;
    // -- Background Settings
    showCollapsibleBackground: boolean;
    // -- Screen Settings
    showCollapsibleSize: boolean;
    showCollapsibleToolbar: boolean;
    showCollapsibleFrame: boolean;
    // -- Camera Settings
    showCollapsibleCameraShape: boolean;
    showCollapsibleShape: boolean;
    showCollapsibleBorder: boolean;
    // -- Captions Settings
    showCollapsibleCaptionAI: boolean;
    showCollapsibleCaptionStyle: boolean;
    showCollapsibleCaptionPosition: boolean;
    // -- Audio Settings
    showCollapsibleAudioToggles: boolean;
    showCollapsibleMusic: boolean;
    setCollapsibleVisibility: (key: string, value: boolean) => void;

    // Track Visibility
    trackVisibility: TrackVisibility;
    setTrackVisibility: (track: keyof TrackVisibility, visible: boolean) => void;

    // Explicit reset to default state
    reset: () => void;
}

/**
 * If the currently selected caption has empty text, delete it from the project.
 * Must be called BEFORE set() so the side-effect runs outside zustand's batch.
 */
function _cleanupEmptyCaption(get: () => UIState) {
    const prevId = get().selectedCaptionId;
    if (!prevId) return;
    const projectState = useProjectStore.getState();
    const segments = projectState.project?.timeline?.captionSegments;
    const prev = segments?.find((s: { id: string }) => s.id === prevId);
    console.log('[_cleanupEmptyCaption] prevId:', prevId, 'found:', !!prev, 'text:', JSON.stringify(prev?.text), 'empty:', !prev?.text?.trim());
    if (prev && !prev.text?.trim()) {
        projectState.deleteCaptionSegment(prevId);
    }
}

export const useUIStore = create<UIState>((set, get) => ({
    // Initial State
    canvasMode: CanvasMode.Preview,
    selectedZoomId: null,
    selectedSpotlightId: null,
    selectedWindowId: null,
    selectedCaptionId: null,
    selectedSettingsPanel: SettingsPanel.Project,
    settingsPanelActiveTab: 'screen' as SettingsPanelTab,
    isResizingWindow: false,

    setIsResizingWindow: (isResizingWindow) => set({ isResizingWindow }),

    // Selection Actions
    setCanvasMode: (canvasMode) => set({
        canvasMode,
        ...(canvasMode === CanvasMode.Preview ? { selectedZoomId: null, selectedSpotlightId: null, selectedWindowId: null } : { isPlaying: false })
    }),

    selectWindow: (selectedWindowId) => {
        if (selectedWindowId) {
            get().selectZoom(null);
            get().selectSpotlight(null);
            get().selectCaption(null);
        }
        set({
            selectedWindowId,
            canvasMode: CanvasMode.Preview,
        });
    },

    selectZoom: (selectedZoomId) => {
        if (selectedZoomId) {
            get().selectSpotlight(null);
            get().selectCaption(null);
            get().selectWindow(null);
        }
        set((state) => {
            if (selectedZoomId) {
                return {
                    selectedZoomId,
                    canvasMode: CanvasMode.ZoomEdit,
                    isPlaying: false,
                };
            }
            return { selectedZoomId: null, canvasMode: CanvasMode.Preview, };
        });
    },

    selectSpotlight: (selectedSpotlightId) => {
        if (selectedSpotlightId) {
            get().selectZoom(null);
            get().selectCaption(null);
            get().selectWindow(null);
        }
        set((state) => {
            if (selectedSpotlightId) {
                return {
                    selectedSpotlightId,
                    canvasMode: CanvasMode.SpotlightEdit,
                    isPlaying: false,
                };
            }
            return { selectedSpotlightId: null, canvasMode: CanvasMode.Preview };
        });
    },

    selectCaption: (selectedCaptionId) => {
        console.log('[selectCaption] called with:', selectedCaptionId, 'current:', get().selectedCaptionId);
        // Cleanup empty caption before changing selection
        if (!selectedCaptionId || selectedCaptionId !== get().selectedCaptionId) {
            _cleanupEmptyCaption(get);
        }
        if (selectedCaptionId) {
            get().selectZoom(null);
            get().selectSpotlight(null);
            get().selectWindow(null);
        }
        set((state) => {
            if (selectedCaptionId) {
                return {
                    selectedCaptionId,
                    selectedSettingsPanel: SettingsPanel.Project,
                    settingsPanelActiveTab: 'captions' as SettingsPanelTab,
                    showCollapsibleCaptionPosition: true,
                    trackVisibility: { ...state.trackVisibility, captions: true },
                };
            }
            console.log('[selectCaption] setting to null');
            return { selectedCaptionId: null };
        });
    },

    deselectAllSegments: () => {
        get().selectZoom(null);
        get().selectSpotlight(null);
        get().selectWindow(null);
        get().selectCaption(null);
        set({ canvasMode: CanvasMode.Preview });
    },

    setSettingsPanel: (selectedSettingsPanel) => set({ selectedSettingsPanel }),
    setSettingsPanelActiveTab: (settingsPanelActiveTab) => set({ settingsPanelActiveTab }),

    // Timeline State
    timelineContainerRef: null,
    setTimelineContainerRef: (timelineContainerRef) => set({ timelineContainerRef }),
    pixelsPerSec: 100, // Default zoom level

    // Canvas Container Size (for DisplayMapper)
    canvasContainerSize: { width: 0, height: 0 },
    setCanvasContainerSize: (canvasContainerSize) => set({ canvasContainerSize }),

    // Playback State
    isPlaying: false,
    currentTimeMs: 0,
    previewTimeMs: null,

    // Performance Monitoring
    // fps: 0,
    // frameTime: 0,
    // setFps: (fps) => set({ fps }),
    // setFrameTime: (frameTime) => set({ frameTime }),

    setPixelsPerSec: (pixelsPerSec) => set({ pixelsPerSec }),

    setIsPlaying: (isPlaying) => set({ isPlaying, canvasMode: CanvasMode.Preview, selectedZoomId: null, selectedSpotlightId: null }),
    setCurrentTime: (currentTimeMs) => {
        const state = get();
        const container = state.timelineContainerRef?.current;

        // Auto-scroll timeline if CTI is outside visible viewport (page-flip logic)
        if (container && !state.isPlaying) {
            const px = (currentTimeMs / 1000) * state.pixelsPerSec;
            const scrollLeft = container.scrollLeft;
            const clientWidth = container.clientWidth;

            if (px > scrollLeft + clientWidth || px < scrollLeft) {
                // Center the CTI in the viewport
                container.scrollTo({ left: px - clientWidth / 2, behavior: 'auto' });
            }
        }

        set({ currentTimeMs });
    },
    setPreviewTime: (previewTimeMs) => set({ previewTimeMs }),

    // Debug Bar
    showDebugBar: false,
    toggleDebugBar: () => set((state) => ({ showDebugBar: !state.showDebugBar })),

    // Debug Overlays
    showDebugOverlays: false,
    toggleDebugOverlays: () => set((state) => ({ showDebugOverlays: !state.showDebugOverlays })),

    // Collapsible Card Visibility
    // -- Effects Settings
    showCollapsibleEffects: false,
    showCollapsibleMouse: false,
    // -- Background Settings
    showCollapsibleBackground: true, // Default expanded
    // -- Screen Settings
    showCollapsibleSize: false,
    showCollapsibleToolbar: false,
    showCollapsibleFrame: false,
    // -- Camera Settings
    showCollapsibleCameraShape: true, // Default expanded
    showCollapsibleShape: true, // Default expanded
    showCollapsibleBorder: false,
    // -- Captions Settings
    showCollapsibleCaptionAI: true, // Default expanded
    showCollapsibleCaptionStyle: true, // Default expanded
    showCollapsibleCaptionPosition: false,
    // -- Audio Settings
    showCollapsibleAudioToggles: true, // Default expanded
    showCollapsibleMusic: true, // Default expanded
    setCollapsibleVisibility: (key, value) => set({ [key]: value } as Partial<UIState>),

    // Track Visibility
    trackVisibility: { ...DEFAULT_TRACK_VISIBILITY },
    setTrackVisibility: (track, visible) => set((state) => ({
        trackVisibility: { ...state.trackVisibility, [track]: visible }
    })),

    reset: () => {
        get().selectCaption(null);
        set({
            canvasMode: CanvasMode.Preview,
            selectedZoomId: null,
            selectedSpotlightId: null,
            selectedWindowId: null,
            selectedCaptionId: null,
            selectedSettingsPanel: SettingsPanel.Project,
            settingsPanelActiveTab: 'screen' as SettingsPanelTab,
            timelineContainerRef: null,
            pixelsPerSec: 100,
            isPlaying: false,
            currentTimeMs: 0,
            previewTimeMs: null,
            // fps: 0,
            // frameTime: 0,
            isResizingWindow: false,
            showDebugBar: false,
            showDebugOverlays: false,
            // Collapsible Card Visibility
            showCollapsibleEffects: false,
            showCollapsibleMouse: false,
            showCollapsibleBackground: true,
            showCollapsibleSize: false,
            showCollapsibleToolbar: false,
            showCollapsibleFrame: false,
            showCollapsibleCameraShape: true,
            showCollapsibleShape: true,
            showCollapsibleBorder: false,
            showCollapsibleCaptionAI: true,
            showCollapsibleCaptionStyle: true,
            showCollapsibleCaptionPosition: false,
            showCollapsibleAudioToggles: true,
            showCollapsibleMusic: true,
            trackVisibility: { ...DEFAULT_TRACK_VISIBILITY },
        });
    }
}));
