
import { create } from 'zustand';
import type { ID, TimeMs } from '../../core/types';

export const CanvasMode = {
    Preview: 'preview',
    CropEdit: 'cropEdit',
    CameraEdit: 'cameraEdit',
    ZoomEdit: 'zoomEdit',
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
    selectedWindowId: ID | null;
    selectedSettingsPanel: SettingsPanel;
    isResizingWindow: boolean;

    setCanvasMode: (mode: Exclude<CanvasMode, typeof CanvasMode.ZoomEdit>) => void;
    setIsResizingWindow: (isResizing: boolean) => void;
    selectWindow: (id: ID | null) => void;
    selectZoom: (id: ID | null) => void;
    setSettingsPanel: (panel: SettingsPanel) => void;

    // Timeline State
    // Timeline State
    pixelsPerSec: number;
    setPixelsPerSec: (pps: number) => void;

    // Playback State
    isPlaying: boolean;
    currentTimeMs: TimeMs;
    previewTimeMs: TimeMs | null;

    // Performance Monitoring
    fps: number;
    frameTime: number;
    setFps: (fps: number) => void;
    setFrameTime: (ms: number) => void;

    setIsPlaying: (playing: boolean) => void;
    setCurrentTime: (timeMs: TimeMs) => void;
    setPreviewTime: (timeMs: TimeMs | null) => void;

    // Explicit reset to default state
    reset: () => void;
}

export const useUIStore = create<UIState>((set) => ({
    // Initial State
    canvasMode: CanvasMode.Preview,
    selectedZoomId: null,
    selectedWindowId: null,
    selectedSettingsPanel: SettingsPanel.Project,
    isResizingWindow: false,

    // Actions
    setCanvasMode: (canvasMode) => set({
        canvasMode,
        ...(canvasMode === CanvasMode.Preview ? { selectedZoomId: null, selectedWindowId: null } : { isPlaying: false })
    }),
    setIsResizingWindow: (isResizingWindow) => set({ isResizingWindow }),

    selectWindow: (selectedWindowId) => set({
        selectedWindowId,
        canvasMode: CanvasMode.Preview,
        selectedZoomId: null,
    }),

    selectZoom: (selectedZoomId) => set((state) => {
        if (selectedZoomId) {
            return {
                selectedZoomId,
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

    setSettingsPanel: (selectedSettingsPanel) => set({ selectedSettingsPanel }),

    // Timeline State
    // Timeline State
    pixelsPerSec: 100, // Default zoom level

    // Playback State
    isPlaying: false,
    currentTimeMs: 0,
    previewTimeMs: null,

    // Performance Monitoring
    fps: 0,
    frameTime: 0,
    setFps: (fps) => set({ fps }),
    setFrameTime: (frameTime) => set({ frameTime }),

    setPixelsPerSec: (pixelsPerSec) => set({ pixelsPerSec }),

    setIsPlaying: (isPlaying) => set({ isPlaying, canvasMode: CanvasMode.Preview, selectedZoomId: null }),
    setCurrentTime: (currentTimeMs) => set({ currentTimeMs }),
    setPreviewTime: (previewTimeMs) => set({ previewTimeMs }),

    reset: () => set({
        canvasMode: CanvasMode.Preview,
        selectedZoomId: null,
        selectedWindowId: null,
        selectedSettingsPanel: SettingsPanel.Project,
        pixelsPerSec: 100,
        isPlaying: false,
        currentTimeMs: 0,
        previewTimeMs: null,
        fps: 0,
        frameTime: 0,
        isResizingWindow: false,
    })
}));
