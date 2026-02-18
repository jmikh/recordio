import type { CSSProperties } from 'react';

// ============================================================================
// ZOOM TRACK STYLES
// Centralized styling for zoom track visual elements.
// Block anatomy: [transition-in zone (left, lighter)] [hold zone (rest, solid)]
// ============================================================================

// ============= SIZE CONSTANTS =============

/** Height of the transition-in segment (shorter, left edge) */
export const TRANSITION_HEIGHT = 20;

/** Height of the hold segment (taller, full block) */
export const HOLD_HEIGHT = 28;

/** Corner radius for segments */
export const SEGMENT_RADIUS = 4;

/** Minimum block width before label is hidden */
export const MIN_BLOCK_LABEL_WIDTH_PX = 40;

/** Height of the visible drag handle indicator */
export const DRAG_HANDLE_HEIGHT = 32;

// ============= TRANSITION-IN SEGMENT (left edge) =============

export const transitionInSegment = {
    base: 'absolute flex-shrink-0 border-2 transition-colors z-[5]',
    defaultClass: 'border-primary',
    selectedClass: 'border-secondary',
    hoverClass: 'group-hover:border-primary-highlighted',
    getStyle: (): CSSProperties => ({
        height: TRANSITION_HEIGHT,
        borderRadius: `${SEGMENT_RADIUS}px 0 0 ${SEGMENT_RADIUS}px`,
        borderRight: 'none',
        background: `repeating-linear-gradient(
            -45deg,
            var(--primary) 0px,
            var(--primary) 1px,
            var(--surface-overlay) 1px,
            var(--surface-overlay) 6px
        )`,
    }),
};

// ============= HOLD SEGMENT (main body) =============

export const holdSegment = {
    base: 'absolute flex-shrink-0 bg-primary rounded-sm transition-colors z-10',
    defaultClass: '',
    selectedClass: 'border-2 border-secondary',
    hoverClass: 'group-hover:bg-primary-highlighted group-hover:scale-y-110',
    getStyle: (): CSSProperties => ({
        height: HOLD_HEIGHT,
        borderRadius: 0,
        boxShadow: 'var(--shadow-segment)',
    }),
};

// ============= CONTAINER =============

export const zoomContainer = {
    base: 'absolute flex items-center',
    dragging: 'cursor-grabbing',
    idle: 'cursor-grab',
};

// ============= RESIZE HANDLES =============

export const resizeHandle = {
    base: 'absolute cursor-ew-resize z-20 flex items-center justify-center',
    width: 12,
    height: DRAG_HANDLE_HEIGHT,
};

export const dragHandleIndicator = {
    base: 'w-1 rounded-full transition-all duration-150 opacity-0 group-hover:opacity-100',
    defaultClass: 'bg-primary-highlighted',
    selectedClass: 'bg-secondary',
    height: DRAG_HANDLE_HEIGHT,
};

// ============= GHOST (Add Zoom indicator) =============

export const ghostZoom = {
    container: 'absolute pointer-events-none z-25 flex items-center',
    label: 'absolute bottom-[calc(100%+2px)] left-1/2 -translate-x-1/2 whitespace-nowrap text-[9px] text-secondary bg-black/90 px-1.5 py-0.5 rounded pointer-events-none',
    transitionIn: {
        className: 'bg-secondary/30 border-2 border-secondary border-r-0',
        getStyle: (): CSSProperties => ({
            height: TRANSITION_HEIGHT,
            borderRadius: `${SEGMENT_RADIUS}px 0 0 ${SEGMENT_RADIUS}px`,
            background: `repeating-linear-gradient(
                -45deg,
                var(--secondary) 0px,
                var(--secondary) 1px,
                transparent 1px,
                transparent 6px
            )`,
            opacity: 0.6,
        }),
    },
    hold: {
        className: 'bg-secondary',
        getStyle: (): CSSProperties => ({
            height: HOLD_HEIGHT,
            opacity: 0.6,
            borderRadius: `0 ${SEGMENT_RADIUS}px ${SEGMENT_RADIUS}px 0`,
        }),
    },
};
