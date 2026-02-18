import type { CSSProperties } from 'react';

// ============================================================================
// ZOOM TRACK STYLES
// Centralized styling for zoom track visual elements.
// Block-based rendering: each zoom action is a rectangle spanning its full time range.
// ============================================================================

// ============= SIZE CONSTANTS =============

/** Height of the zoom block as a fraction of track height */
export const BLOCK_HEIGHT_FRACTION = 0.55;

/** Border radius of zoom blocks in pixels */
export const BLOCK_BORDER_RADIUS = 4;

/** Minimum block width before label is hidden */
export const MIN_BLOCK_LABEL_WIDTH_PX = 40;

// ============= BLOCK STYLES =============

/** Main zoom block rectangle */
export const zoomBlock = {
    base: 'absolute top-1/2 -translate-y-1/2 rounded cursor-grab transition-colors duration-100 group flex items-center overflow-hidden',
    default: 'bg-primary/70 hover:bg-primary',
    selected: 'bg-secondary ring-1 ring-secondary/60',
    dragging: 'cursor-grabbing opacity-80',
};

/** Scale label inside the block */
export const blockLabel = {
    className: 'text-[9px] font-mono text-white/90 px-1.5 whitespace-nowrap pointer-events-none select-none truncate',
};

/** Transition-in indicator (left edge of block) */
export const transitionInEdge = {
    className: 'absolute left-0 top-0 bottom-0 bg-white/20 pointer-events-none',
};

/** Transition-out indicator (right edge of block) */
export const transitionOutEdge = {
    className: 'absolute right-0 top-0 bottom-0 bg-white/20 pointer-events-none',
};

// ============= GHOST STYLES (Add Zoom indicator) =============

export const ghostBlock = {
    className: 'absolute top-1/2 -translate-y-1/2 rounded pointer-events-none z-25 bg-secondary/50 border border-secondary/80 flex items-center',
    label: 'text-[9px] text-white px-1.5 whitespace-nowrap pointer-events-none select-none',
};

// Keep legacy ghost styles for any remaining usages
export const ghostKeyframe = {
    container: 'absolute top-1/2 -translate-x-1/2 -translate-y-1/2 z-25 pointer-events-none flex flex-col items-center',
    label: 'absolute bottom-[calc(100%+6px)] whitespace-nowrap text-[9px] text-secondary bg-black/90 px-1.5 py-0.5 rounded pointer-events-none',
    diamond: 'rotate-45 bg-secondary',
    diamondStyle: {
        width: 14,
        height: 14,
        borderRadius: 1,
    } as CSSProperties,
};

export const ghostTrail = {
    className: 'absolute top-1/2 -translate-y-1/2 pointer-events-none z-15 bg-secondary',
    opacity: 0.5,
    height: 5,
};
