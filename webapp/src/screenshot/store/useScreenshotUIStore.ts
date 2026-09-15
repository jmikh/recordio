/**
 * Transient screenshot-editor UI state (not persisted, not in history):
 * the active tool, the selection, inline text editing and the crop draft.
 */
import { create } from 'zustand';
import type { Rect } from '@shared/types';

export type ScreenshotTool = 'select' | 'text' | 'arrow' | 'line' | 'rect' | 'ellipse' | 'blur' | 'crop';

interface ScreenshotUIState {
    tool: ScreenshotTool;
    selectedId: string | null;
    /** The selected text item is in contentEditable mode */
    isEditingText: boolean;
    /** Crop rectangle being adjusted (uncropped source px) while `tool === 'crop'` */
    cropDraft: Rect | null;

    setTool: (tool: ScreenshotTool) => void;
    select: (id: string | null) => void;
    enterTextEdit: () => void;
    exitTextEdit: () => void;
    setCropDraft: (rect: Rect | null) => void;
    reset: () => void;
}

const initial = {
    tool: 'select' as ScreenshotTool,
    selectedId: null,
    isEditingText: false,
    cropDraft: null,
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
    reset: () => set(initial),
}));
