
import { create } from 'zustand';
import type { ID, TimeMs, Size } from '../../types';

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
    Zoom: 'zoom',
    Export: 'export',
} as const;
export type SettingsPanel = typeof SettingsPanel[keyof typeof SettingsPanel];

export type SettingsPanelTab = 'project' | 'screen' | 'zoom' | 'background' | 'camera' | 'captions';

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
    showCollapsibleZoom: boolean;
    showCollapsibleSpotlight: boolean;
    showCollapsibleEffects: boolean;
    // -- Background Settings
    showCollapsibleBackground: boolean;
    // -- Screen Settings
    showCollapsibleSize: boolean;
    showCollapsibleFrame: boolean;
    // -- Camera Settings
    showCollapsibleShape: boolean;
    showCollapsibleBorder: boolean;
    // -- Captions Settings
    showCollapsibleCaptionStyle: boolean;
    showCollapsibleCaptionPosition: boolean;
    setCollapsibleVisibility: (key: string, value: boolean) => void;

    // Explicit reset to default state
    reset: () => void;
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

    // Actions
    setCanvasMode: (canvasMode) => set({
        canvasMode,
        ...(canvasMode === CanvasMode.Preview ? { selectedZoomId: null, selectedSpotlightId: null, selectedWindowId: null } : { isPlaying: false })
    }),
    setIsResizingWindow: (isResizingWindow) => set({ isResizingWindow }),

    selectWindow: (selectedWindowId) => set({
        selectedWindowId,
        canvasMode: CanvasMode.Preview,
        selectedZoomId: null,
        selectedSpotlightId: null,
        selectedCaptionId: null,
    }),

    selectZoom: (selectedZoomId) => set((state) => {
        if (selectedZoomId) {
            return {
                selectedZoomId,
                selectedSpotlightId: null,
                selectedWindowId: null,
                selectedCaptionId: null,
                canvasMode: CanvasMode.ZoomEdit,
                isPlaying: false,
            };
        }
        if (state.canvasMode === CanvasMode.ZoomEdit) {
            return {
                selectedZoomId: null,
                canvasMode: CanvasMode.Preview,
            };
        }
        return { selectedZoomId: null };
    }),

    selectSpotlight: (selectedSpotlightId) => set((state) => {
        if (selectedSpotlightId) {
            return {
                selectedSpotlightId,
                selectedZoomId: null,
                selectedWindowId: null,
                selectedCaptionId: null,
                canvasMode: CanvasMode.SpotlightEdit,
                isPlaying: false,
            };
        }
        if (state.canvasMode === CanvasMode.SpotlightEdit) {
            return {
                selectedSpotlightId: null,
                canvasMode: CanvasMode.Preview,
            };
        }
        return { selectedSpotlightId: null };
    }),

    selectCaption: (selectedCaptionId) => set((state) => {
        if (selectedCaptionId) {
            return {
                selectedCaptionId,
                selectedZoomId: null,
                selectedSpotlightId: null,
                selectedWindowId: null,
            };
        }
        return { selectedCaptionId: null };
    }),

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
    showCollapsibleZoom: true, // Default expanded
    showCollapsibleSpotlight: false,
    showCollapsibleEffects: false,
    // -- Background Settings
    showCollapsibleBackground: true, // Default expanded
    // -- Screen Settings
    showCollapsibleSize: false,
    showCollapsibleFrame: false,
    // -- Camera Settings
    showCollapsibleShape: true, // Default expanded
    showCollapsibleBorder: false,
    // -- Captions Settings
    showCollapsibleCaptionStyle: true, // Default expanded
    showCollapsibleCaptionPosition: false,
    setCollapsibleVisibility: (key, value) => set({ [key]: value } as Partial<UIState>),

    reset: () => set({
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
        showCollapsibleZoom: true,
        showCollapsibleSpotlight: false,
        showCollapsibleEffects: false,
        showCollapsibleBackground: true,
        showCollapsibleSize: false,
        showCollapsibleFrame: false,
        showCollapsibleShape: true,
        showCollapsibleBorder: false,
        showCollapsibleCaptionStyle: true,
        showCollapsibleCaptionPosition: false,
    })
}));
