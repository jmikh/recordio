import type { CSSProperties } from 'react';

// ============================================================================
// CAPTION TRACK STYLES
// Centralized styling for caption track visual elements.
// Uses CSS variables (var(--primary), var(--secondary)) from design system.
// ============================================================================

// ============= SIZE CONSTANTS =============

/** Height of the caption block */
export const CAPTION_BLOCK_HEIGHT = 12;

/** Corner radius for blocks */
export const SEGMENT_RADIUS = 6;

/** Height of the visible drag handle indicator */
export const DRAG_HANDLE_HEIGHT = 24;

// ============= BLOCK STYLES =============

/** Caption block — solid primary fill */
export const captionBlock = {
    base: 'absolute flex items-center overflow-hidden transition-colors bg-primary',
    defaultClass: '',
    selectedClass: 'border border-secondary border-2',
    hoverClass: 'group-hover:bg-primary-highlighted',
    height: CAPTION_BLOCK_HEIGHT,
    getStyle: (): CSSProperties => ({
        height: CAPTION_BLOCK_HEIGHT,
        borderRadius: SEGMENT_RADIUS,
    }),
};

// ============= CONTAINER STYLES =============

/** Container for the entire caption block (hit area) */
export const captionContainer = {
    base: 'absolute flex items-center',
    dragging: 'cursor-grabbing',
    idle: 'cursor-grab',
};

/** Resize handle styles — hit area for resizing */
export const resizeHandle = {
    base: 'absolute cursor-ew-resize z-20 flex items-center justify-center',
    width: 12,
    height: DRAG_HANDLE_HEIGHT,
};

/** Visible drag handle indicator that appears on hover */
export const dragHandleIndicator = {
    base: 'w-1 rounded-full transition-all duration-150 opacity-0 group-hover:opacity-100',
    defaultClass: 'bg-primary-highlighted',
    selectedClass: 'bg-secondary',
    height: DRAG_HANDLE_HEIGHT,
};

// ============= GHOST STYLES (Add Caption indicator) =============

export const ghostCaption = {
    container: 'absolute pointer-events-none z-25 flex items-center',
    label: 'absolute bottom-[calc(100%+2px)] left-1/2 -translate-x-1/2 whitespace-nowrap text-[9px] text-secondary bg-black/90 px-1.5 py-0.5 rounded pointer-events-none',
    block: {
        className: 'border border-secondary',
        getStyle: (): CSSProperties => ({
            height: CAPTION_BLOCK_HEIGHT,
            borderRadius: SEGMENT_RADIUS,
            background: 'var(--secondary)',
            opacity: 0.5,
        }),
    },
};
