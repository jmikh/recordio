import type { CSSProperties } from 'react';

// ============================================================================
// TIMELINE BLOCK STYLES
// Unified styling for all timeline track visual elements.
// Color is driven by the CSS variable --block-bg, set on the container from
// the track's colour (trackBlockColor). Hover swaps it for the track's
// highlighted variant, cascading to all children.
// ============================================================================

// ============= ICON CONSTANTS =============

/** Minimum hold width (in px) before the icon is hidden */
export const MIN_ICON_WIDTH_PX = 28;

/** Minimum block width before label text is hidden */
export const MIN_BLOCK_LABEL_WIDTH_PX = 40;

/** className for a block icon */
export const blockIconClass = 'text-text-on-primary/70';

/** className for text on a block (zoom factor, clip speed/duration) */
export const blockLabelClass = `${blockIconClass} text-2xs leading-none whitespace-nowrap tabular-nums`;

/** className for a ghost block icon — the translucent fill is pale on light theme, so follow text colour */
export const ghostIconClass = 'text-text-main/70';

// ============= SEGMENT RADIUS =============

/** Unified corner radius for all track segments */
export const SEGMENT_RADIUS = 8;

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

// ============= TRACK COLORS =============

/**
 * Per-track block colour — tokens are --track-* in shared/theme/index.css.
 * `base` goes on the block container; `hover` too, unless selected or disabled.
 * Class strings stay literal so Tailwind picks them up.
 */
export const trackBlockColor = {
    clip: {
        base: '[--block-bg:var(--track-clip)]',
        hover: 'hover:[--block-bg:var(--track-clip-highlighted)]',
    },
    zoom: {
        base: '[--block-bg:var(--track-zoom)]',
        hover: 'hover:[--block-bg:var(--track-zoom-highlighted)]',
    },
    spotlight: {
        base: '[--block-bg:var(--track-spotlight)]',
        hover: 'hover:[--block-bg:var(--track-spotlight-highlighted)]',
    },
    blur: {
        base: '[--block-bg:var(--track-blur)]',
        hover: 'hover:[--block-bg:var(--track-blur-highlighted)]',
    },
    camera: {
        base: '[--block-bg:var(--track-camera)]',
        hover: 'hover:[--block-bg:var(--track-camera-highlighted)]',
    },
};

// ============= CONTAINER =============

/** Cursor classes shared by all block containers */
export const containerCursors = {
    dragging: 'cursor-grabbing',
    idle: 'cursor-grab',
};

/** Block container — absolute positioned; pair with a trackBlockColor entry */
export const blockContainer = {
    base: 'absolute flex items-center',
    ...containerCursors,
};

// ============= RESIZE HANDLES =============

/** Resize handle styles — invisible hit area, fills parent + 1px overflow */
export const resizeHandle = {
    base: 'absolute cursor-ew-resize z-30 flex items-center justify-center',
    width: 12,
};

/** Visible drag handle indicator that appears on hover — only shown while the
 *  block is hovered, so --block-bg already holds the highlighted track colour */
export const dragHandleIndicator = {
    base: 'w-1 rounded-full transition-all duration-150 opacity-0 group-hover:opacity-100 border border-text-main/50',
    defaultClass: 'bg-[var(--block-bg)]',
    selectedClass: 'bg-secondary',
    leftClass: 'border-r-0',
    rightClass: 'border-l-0',
};

// ============= SHAPE HELPERS =============

/** Base height used in getStyle() — overridden inline by trackHeight - 2 */
const BASE_HEIGHT = 28;

/** Common hold shape: gradient fill + segment shadow */
export function holdShapeBase(height: number = BASE_HEIGHT): CSSProperties {
    return {
        height,
        boxShadow: '0 1px 3px oklch(0 0 0 / 12%), 0 0 0 1px oklch(0 0 0 / 5%)',
        background: 'linear-gradient(to bottom, color-mix(in srgb, var(--block-bg) 100%, transparent), color-mix(in srgb, var(--block-bg) 75%, transparent))',
    };
}

/** Common semi-transparent shape (ghost blocks, zoom-out indicator) */
export function transitionShapeBase(height: number = BASE_HEIGHT): CSSProperties {
    return {
        height,
        backgroundColor: 'color-mix(in srgb, var(--block-bg) 50%, transparent)',
    };
}

// ============= SEGMENT STYLES =============

/** Hold segment — the solid body of every block */
export const holdSegment = {
    base: `absolute flex-shrink-0 transition-colors z-10 ${blockBorder.base} ${blockBorder.highlighted}`,
    defaultClass: '',
    selectedClass: blockBorder.selected,
    hoverClass: '',
    getStyle: holdStyle,
};

// ============= SEGMENT STYLE GETTERS =============

/** Hold shape: solid fill, no border radius (inner edges) */
export function holdStyle(): CSSProperties {
    return {
        ...holdShapeBase(),
        borderRadius: 0,
    };
}

// ============= GHOST STYLES =============

/** Label class for ghost "add" indicators */
export const ghostLabel =
    'absolute bottom-[calc(100%+2px)] left-1/2 -translate-x-1/2 whitespace-nowrap text-2xs text-secondary bg-black/90 px-1.5 py-0.5 rounded pointer-events-none';

/** Base container class for ghost blocks — pair with a trackBlockColor entry */
export const ghostContainerBase =
    'absolute pointer-events-none z-25 flex items-center';

/** Ghost segment — single rounded segment, the track colour at half opacity */
export const ghostBlock = {
    className: blockBorder.base,
    getStyle: (): CSSProperties => ({
        ...transitionShapeBase(),
        borderRadius: SEGMENT_RADIUS,
    }),
};

/** Ghost zoom block */
export const ghostZoom = {
    container: `${ghostContainerBase} ${trackBlockColor.zoom.base}`,
    label: ghostLabel,
    block: ghostBlock,
};

/** Ghost spotlight block */
export const ghostSpotlight = {
    container: `${ghostContainerBase} ${trackBlockColor.spotlight.base}`,
    label: ghostLabel,
    block: ghostBlock,
};

/** Ghost caption block — single rounded segment */
export const ghostCaption = {
    container: ghostContainerBase,
    label: ghostLabel,
    block: {
        className: blockBorder.base,
        getStyle: (): CSSProperties => holdStyle(),
    },
};

/** Ghost camera layout block */
export const ghostCameraMove = {
    container: `${ghostContainerBase} ${trackBlockColor.camera.base}`,
    label: ghostLabel,
    block: ghostBlock,
};

// ============= ZOOM-OUT INDICATOR =============

/** Non-interactable zoom-out indicator segment */
export const zoomOutBlock = {
    base: `absolute pointer-events-none flex items-center justify-center overflow-hidden ${blockBorder.base}`,
    getStyle: (): CSSProperties => ({
        ...transitionShapeBase(),
        borderRadius: `0 ${SEGMENT_RADIUS}px ${SEGMENT_RADIUS}px 0`,
        borderLeft: 'none',
    }),
};
