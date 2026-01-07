
import { create } from 'zustand';
import type { ID } from '../../core/types';

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

    setCanvasMode: (mode: Exclude<CanvasMode, typeof CanvasMode.ZoomEdit>) => void;
    selectWindow: (id: ID | null) => void;
    selectZoom: (id: ID | null) => void;
    setSettingsPanel: (panel: SettingsPanel) => void;

    // Timeline State
    timelineOffset: number;
    pixelsPerSec: number;
    setTimelineOffset: (offset: number) => void;
    setPixelsPerSec: (pps: number) => void;

    // Explicit reset to default state
    reset: () => void;
}

export const useUIStore = create<UIState>((set) => ({
    // Initial State
    canvasMode: CanvasMode.Preview,
    selectedZoomId: null,
    selectedWindowId: null,
    selectedSettingsPanel: SettingsPanel.Project,

    // Actions
    setCanvasMode: (canvasMode) => set({
        canvasMode,
        ...(canvasMode === CanvasMode.Preview ? { selectedZoomId: null, selectedWindowId: null } : {})
    }),

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
    timelineOffset: 0,
    pixelsPerSec: 100, // Default zoom level

    setTimelineOffset: (timelineOffset) => set({ timelineOffset }),
    setPixelsPerSec: (pixelsPerSec) => set({ pixelsPerSec }),

    reset: () => set({
        canvasMode: CanvasMode.Preview,
        selectedZoomId: null,
        selectedWindowId: null,
        selectedSettingsPanel: SettingsPanel.Project,
        timelineOffset: 0,
        pixelsPerSec: 100
    })
}));
