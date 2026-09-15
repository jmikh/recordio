/**
 * Transient screenshot-editor UI state (not persisted, not in history):
 * the active tool, the selection, inline text editing, the crop draft and
 * the view zoom.
 */
import { create } from 'zustand';
import type { Rect } from '@shared/types';
import type { Point } from '../geometry';

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 4;
/** Multiplier per zoom-in / zoom-out step (buttons, ⌘+ / ⌘−). */
export const ZOOM_STEP = 1.25;

const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

export type ScreenshotTool = 'select' | 'text' | 'arrow' | 'line' | 'rect' | 'ellipse' | 'blur' | 'crop';

interface ScreenshotUIState {
    tool: ScreenshotTool;
    selectedId: string | null;
    /** The selected text item is in contentEditable mode */
    isEditingText: boolean;
    /** Crop rectangle being adjusted (uncropped source px) while `tool === 'crop'` */
    cropDraft: Rect | null;
    /** Display px per source px; null = fit to the container width (view only, never saved) */
    zoom: number | null;
    /** Client point to keep fixed while the zoom changes (null = centre of the scroll area) */
    zoomAnchor: Point | null;
    /** The fit-to-width scale, published by the canvas so zoom steps start from it */
    fitScale: number;

    setTool: (tool: ScreenshotTool) => void;
    select: (id: string | null) => void;
    enterTextEdit: () => void;
    exitTextEdit: () => void;
    setCropDraft: (rect: Rect | null) => void;
    setFitScale: (scale: number) => void;
    setZoom: (zoom: number | null, anchor?: Point | null) => void;
    /** Multiplies the current (effective) zoom by `factor` */
    zoomBy: (factor: number, anchor?: Point | null) => void;
    zoomIn: () => void;
    zoomOut: () => void;
    resetZoom: () => void;
    reset: () => void;
}

/** The scale the canvas displays at: the explicit zoom, or fit-to-width. */
export const effectiveZoom = (s: Pick<ScreenshotUIState, 'zoom' | 'fitScale'>): number => s.zoom ?? s.fitScale;

const initial = {
    tool: 'select' as ScreenshotTool,
    selectedId: null,
    isEditingText: false,
    cropDraft: null,
    zoom: null,
    zoomAnchor: null,
    fitScale: 1,
};

export const useScreenshotUIStore = create<ScreenshotUIState>((set) => ({
    ...initial,

    setTool: (tool) => set(state => ({
        tool,
        // Leaving select drops the selection; leaving crop drops the draft
        selectedId: tool === 'select' ? state.selectedId : null,
        isEditingText: false,
        cropDraft: tool === 'crop' ? state.cropDraft : null,
    })),
    select: (selectedId) => set(state => ({
        selectedId,
        isEditingText: selectedId === state.selectedId ? state.isEditingText : false,
    })),
    enterTextEdit: () => set({ isEditingText: true }),
    exitTextEdit: () => set({ isEditingText: false }),
    setCropDraft: (cropDraft) => set({ cropDraft }),
    setFitScale: (fitScale) => set({ fitScale }),
    setZoom: (zoom, anchor = null) => set({ zoom: zoom === null ? null : clampZoom(zoom), zoomAnchor: anchor }),
    zoomBy: (factor, anchor = null) => set(state => ({ zoom: clampZoom(effectiveZoom(state) * factor), zoomAnchor: anchor })),
    zoomIn: () => set(state => ({ zoom: clampZoom(effectiveZoom(state) * ZOOM_STEP), zoomAnchor: null })),
    zoomOut: () => set(state => ({ zoom: clampZoom(effectiveZoom(state) / ZOOM_STEP), zoomAnchor: null })),
    resetZoom: () => set({ zoom: null, zoomAnchor: null }),
    // Keep fitScale: the canvas re-publishes it only when the layout changes
    reset: () => set(state => ({ ...initial, fitScale: state.fitScale })),
}));
