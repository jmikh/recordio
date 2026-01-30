
import { create } from 'zustand';
import type { ID, TimeMs } from '../../core/types';

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

export interface UIState {
    canvasMode: CanvasMode;
    selectedZoomId: ID | null;
    selectedSpotlightId: ID | null;
    selectedWindowId: ID | null;
    selectedSettingsPanel: SettingsPanel;
    isResizingWindow: boolean;

    setCanvasMode: (mode: Exclude<CanvasMode, typeof CanvasMode.ZoomEdit | typeof CanvasMode.SpotlightEdit>) => void;
    setIsResizingWindow: (isResizing: boolean) => void;
    selectWindow: (id: ID | null) => void;
    selectZoom: (id: ID | null) => void;
    selectSpotlight: (id: ID | null) => void;
    setSettingsPanel: (panel: SettingsPanel) => void;

    // Timeline State
    timelineContainerRef: React.RefObject<HTMLDivElement | null> | null;
    setTimelineContainerRef: (ref: React.RefObject<HTMLDivElement | null> | null) => void;
    pixelsPerSec: number;
    setPixelsPerSec: (pps: number) => void;

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

    // Explicit reset to default state
    reset: () => void;
}

export const useUIStore = create<UIState>((set, get) => ({
    // Initial State
    canvasMode: CanvasMode.Preview,
    selectedZoomId: null,
    selectedSpotlightId: null,
    selectedWindowId: null,
    selectedSettingsPanel: SettingsPanel.Project,
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
    }),

    selectZoom: (selectedZoomId) => set((state) => {
        if (selectedZoomId) {
            return {
                selectedZoomId,
                selectedSpotlightId: null,
                selectedWindowId: null,
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

    setSettingsPanel: (selectedSettingsPanel) => set({ selectedSettingsPanel }),

    // Timeline State
    timelineContainerRef: null,
    setTimelineContainerRef: (timelineContainerRef) => set({ timelineContainerRef }),
    pixelsPerSec: 100, // Default zoom level

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
    showDebugOverlays: true,
    toggleDebugOverlays: () => set((state) => ({ showDebugOverlays: !state.showDebugOverlays })),

    reset: () => set({
        canvasMode: CanvasMode.Preview,
        selectedZoomId: null,
        selectedSpotlightId: null,
        selectedWindowId: null,
        selectedSettingsPanel: SettingsPanel.Project,
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
    })
}));
