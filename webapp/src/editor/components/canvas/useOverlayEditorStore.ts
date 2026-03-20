/**
 * Overlay Editor UI Store
 *
 * Local interaction state for the canvas overlay editor.
 * Selection state (selectedOverlaySegmentId/selectedOverlayItemId) lives in
 * useUIStore since it's cross-cutting (timeline, inspector, canvas).
 * This store manages the canvas editor's own interaction state machine.
 */

import { create } from 'zustand';

export type OverlayInteractionMode = 'selected' | 'editing';

interface OverlayEditorState {
    /** Current interaction mode for the selected item */
    interactionMode: OverlayInteractionMode;

    /** Item being hovered on canvas (for highlight/cursor hints) */
    hoveredItemId: string | null;

    /** Whether a drag is in progress (suppresses hover, shows move cursor) */
    isDragging: boolean;

    // Actions
    enterEditMode: () => void;
    exitEditMode: () => void;
    setHoveredItem: (id: string | null) => void;
    setDragging: (dragging: boolean) => void;
    reset: () => void;
}

export const useOverlayEditorStore = create<OverlayEditorState>((set) => ({
    interactionMode: 'selected',
    hoveredItemId: null,
    isDragging: false,

    enterEditMode: () => set({ interactionMode: 'editing' }),
    exitEditMode: () => set({ interactionMode: 'selected' }),
    setHoveredItem: (hoveredItemId) => set({ hoveredItemId }),
    setDragging: (isDragging) => set({ isDragging }),

    reset: () => set({
        interactionMode: 'selected',
        hoveredItemId: null,
        isDragging: false,
    }),
}));
