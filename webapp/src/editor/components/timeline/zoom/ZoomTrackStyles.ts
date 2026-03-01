import type { CSSProperties } from 'react';
import {
    SEGMENT_RADIUS,
    containerCursors,
    resizeHandle as sharedResizeHandle,
    dragHandleIndicator as sharedDragHandleIndicator,
    ghostLabel,
    ghostContainerBase,
    holdShapeBase,
    transitionShapeBase,
    blockBorder,
} from '../TimelineBlockStyles';

// ============================================================================
// ZOOM TRACK STYLES
// Centralized styling for zoom track visual elements.
// Block anatomy: [transition-in zone (left, lighter)] [hold zone (rest, solid)]
//
// Color is driven by the CSS variable --block-bg, set on the container.
// Hover changes --block-bg to primary-highlighted, cascading to all children.
// ============================================================================

// ============= SIZE CONSTANTS =============

/** Height of the hold segment (taller, full block) */
export const HOLD_HEIGHT = 28;

/** Minimum block width before label is hidden */
export const MIN_BLOCK_LABEL_WIDTH_PX = 40;

/** Height of the visible drag handle indicator */
export const DRAG_HANDLE_HEIGHT = 32;

// Re-export shared values used by components
export { SEGMENT_RADIUS };

// ============= SHARED SHAPE HELPERS =============

/** Transition-in shape: left-rounded, semi-transparent fill, no right border */
function transitionInShape(): CSSProperties {
    return {
        ...transitionShapeBase(HOLD_HEIGHT),
        borderRadius: `${SEGMENT_RADIUS}px 0 0 ${SEGMENT_RADIUS}px`,
        borderRight: 'none',
    };
}

/** Hold shape: solid fill with shadow */
function holdShape(): CSSProperties {
    return {
        ...holdShapeBase(HOLD_HEIGHT),
        borderRadius: 0,
    };
}

// ============= CONTAINER =============

export const zoomContainer = {
    base: 'absolute flex items-center [--block-bg:var(--primary)]',
    hoverClass: 'hover:[--block-bg:var(--primary-highlighted)]',
    ...containerCursors,
};

// ============= TRANSITION-IN SEGMENT (left edge) =============

export const transitionInSegment = {
    base: `absolute flex-shrink-0 ${blockBorder.base} ${blockBorder.highlighted} transition-colors z-[5]`,
    defaultClass: '',
    selectedClass: blockBorder.selected,
    hoverClass: '',
    getStyle: (): CSSProperties => transitionInShape(),
};

// ============= HOLD SEGMENT (main body) =============

export const holdSegment = {
    base: `absolute flex-shrink-0 rounded-sm transition-colors z-10 ${blockBorder.base} ${blockBorder.highlighted}`,
    defaultClass: '',
    selectedClass: blockBorder.selected,
    hoverClass: '',
    getStyle: (): CSSProperties => holdShape(),
};

// ============= RESIZE HANDLES =============

export const resizeHandle = {
    ...sharedResizeHandle,
    height: DRAG_HANDLE_HEIGHT,
};

export const dragHandleIndicator = {
    ...sharedDragHandleIndicator,
    height: DRAG_HANDLE_HEIGHT,
};

// ============= GHOST (Add Zoom indicator) =============

export const ghostZoom = {
    container: ghostContainerBase,
    label: ghostLabel,
    transitionIn: {
        className: blockBorder.base,
        getStyle: (): CSSProperties => transitionInShape(),
    },
    hold: {
        className: blockBorder.base,
        getStyle: (): CSSProperties => ({
            ...holdShape(),
            borderRadius: `0 ${SEGMENT_RADIUS}px ${SEGMENT_RADIUS}px 0`,
        }),
    },
};

// ============= ZOOM-OUT INDICATOR (non-interactable) =============

export const zoomOutBlock = {
    base: `absolute pointer-events-none flex items-center justify-center overflow-hidden ${blockBorder.base}`,
    getStyle: (): CSSProperties => ({
        ...transitionShapeBase(HOLD_HEIGHT),
        borderRadius: `0 ${SEGMENT_RADIUS}px ${SEGMENT_RADIUS}px 0`,
        borderLeft: 'none',
    }),
};
