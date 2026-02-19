import type { CSSProperties } from 'react';
import {
    SEGMENT_RADIUS,
    containerCursors,
    resizeHandle as sharedResizeHandle,
    dragHandleIndicator as sharedDragHandleIndicator,
    ghostLabel,
    ghostContainerBase,
    holdShapeBase,
} from '../TimelineBlockStyles';

// ============================================================================
// CAPTION TRACK STYLES
// Centralized styling for caption track visual elements.
//
// Color is driven by the CSS variable --block-bg, set on the container.
// Hover changes --block-bg to primary-highlighted, cascading to all children.
// ============================================================================

// ============= SIZE CONSTANTS =============

/** Height of the caption block */
export const CAPTION_BLOCK_HEIGHT = 18;

/** Height of the visible drag handle indicator */
export const DRAG_HANDLE_HEIGHT = 24;

// Re-export shared values used by components
export { SEGMENT_RADIUS };

// ============= BLOCK STYLES =============

/** Caption block — solid fill driven by --block-bg */
export const captionBlock = {
    base: 'absolute flex items-center overflow-hidden transition-colors',
    defaultClass: '',
    selectedClass: 'border border-secondary border-2',
    hoverClass: '',
    height: CAPTION_BLOCK_HEIGHT,
    getStyle: (): CSSProperties => ({
        ...holdShapeBase(CAPTION_BLOCK_HEIGHT),
        borderRadius: SEGMENT_RADIUS,
    }),
};

// ============= CONTAINER STYLES =============

/** Container for the entire caption block (hit area) */
export const captionContainer = {
    base: 'absolute flex items-center [--block-bg:var(--primary)]',
    hoverClass: 'hover:[--block-bg:var(--primary-highlighted)]',
    ...containerCursors,
};

/** Resize handle styles — hit area for resizing */
export const resizeHandle = {
    ...sharedResizeHandle,
    height: DRAG_HANDLE_HEIGHT,
};

/** Visible drag handle indicator that appears on hover */
export const dragHandleIndicator = {
    ...sharedDragHandleIndicator,
    height: DRAG_HANDLE_HEIGHT,
};

// ============= GHOST STYLES (Add Caption indicator) =============

export const ghostCaption = {
    container: ghostContainerBase,
    label: ghostLabel,
    block: {
        className: 'border border-[var(--block-bg)]',
        getStyle: (): CSSProperties => ({
            height: CAPTION_BLOCK_HEIGHT,
            borderRadius: SEGMENT_RADIUS,
            backgroundColor: 'var(--block-bg)',
            boxShadow: 'var(--shadow-segment)',
        }),
    },
};
