import type { CSSProperties } from 'react';

// ============================================================================
// SHARED TIMELINE BLOCK STYLES
// Common constants and styles shared across Zoom, Spotlight, and Caption tracks.
// ============================================================================

// ============= ICON CONSTANTS =============

/** Size of the block icon in pixels */
export const BLOCK_ICON_SIZE = 16;

/** Minimum hold width (in px) before the icon is hidden */
export const MIN_ICON_WIDTH_PX = 28;

/** Returns the full className for a block icon */
export const blockIconClass = 'text-text-on-primary/70';

// ============= SEGMENT RADIUS =============

/** Unified corner radius for all track segments */
export const SEGMENT_RADIUS = 4;

/** Shared border width for all block segments */
export const BLOCK_BORDER_WIDTH = 1;

/** Shared block border classes — change these to restyle all blocks at once */
export const blockBorder = {
    /** Default border color (applied on each segment's base class) */
    base: 'border border-text-main/30',
    /** Highlighted border color (applied via group-hover on segments) */
    highlighted: 'group-hover:border-text-main/50',
    /** Selected border (2px + secondary color) */
    selected: 'border-2 !border-secondary',
};

// ============= CONTAINER CURSORS =============

/** Cursor classes shared by all block containers */
export const containerCursors = {
    dragging: 'cursor-grabbing',
    idle: 'cursor-grab',
};

// ============= RESIZE HANDLES =============

/** Resize handle styles — invisible hit area for resizing */
export const resizeHandle = {
    base: 'absolute cursor-ew-resize z-30 flex items-center justify-center',
    width: 12,
    height: 32,
};

/** Visible drag handle indicator that appears on hover */
export const dragHandleIndicator = {
    base: 'w-1 rounded-full transition-all duration-150 opacity-0 group-hover:opacity-100',
    defaultClass: 'bg-primary-highlighted',
    selectedClass: 'bg-secondary',
    height: 32,
};

// ============= GHOST STYLES =============

/** Label class for ghost "add" indicators — shared across all tracks */
export const ghostLabel =
    'absolute bottom-[calc(100%+2px)] left-1/2 -translate-x-1/2 whitespace-nowrap text-[9px] text-secondary bg-black/90 px-1.5 py-0.5 rounded pointer-events-none';

/** Base container class for ghost blocks */
export const ghostContainerBase =
    'absolute pointer-events-none z-25 flex items-center [--block-bg:var(--secondary)]';

// ============= HOLD SHAPE =============

/** Common hold shape properties (gradient fill + top highlight + segment shadow) */
export function holdShapeBase(height: number): CSSProperties {
    return {
        height,
        boxShadow: 'var(--shadow-segment)',
        background: 'linear-gradient(to bottom, color-mix(in srgb, var(--block-bg) 90%, transparent), color-mix(in srgb, var(--block-bg) 70%, transparent))',
    };
}

// ============= TRANSITION / FADE SHAPE =============

/** Common semi-transparent shape for transition/fade segments (primary/50 fill) */
export function transitionShapeBase(height: number): CSSProperties {
    return {
        height,
        backgroundColor: 'color-mix(in srgb, var(--block-bg) 50%, transparent)',
    };
}
