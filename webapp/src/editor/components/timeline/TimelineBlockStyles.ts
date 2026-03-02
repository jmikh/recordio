import type { CSSProperties } from 'react';

// ============================================================================
// TIMELINE BLOCK STYLES
// Unified styling for all timeline track visual elements.
// Color is driven by the CSS variable --block-bg, set on the container.
// Hover changes --block-bg to primary-highlighted, cascading to all children.
// ============================================================================

// ============= ICON CONSTANTS =============

/** Size of the block icon in pixels */
export const BLOCK_ICON_SIZE = 16;

/** Minimum hold width (in px) before the icon is hidden */
export const MIN_ICON_WIDTH_PX = 28;

/** Minimum block width before label text is hidden */
export const MIN_BLOCK_LABEL_WIDTH_PX = 40;

/** className for a block icon */
export const blockIconClass = 'text-text-on-primary/70';

/** className for a ghost block icon */
export const ghostIconClass = 'text-text-on-secondary/70';

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

// ============= CONTAINER =============

/** Cursor classes shared by all block containers */
export const containerCursors = {
    dragging: 'cursor-grabbing',
    idle: 'cursor-grab',
};

/** Block container — absolute positioned with CSS color variable */
export const blockContainer = {
    base: 'absolute flex items-center [--block-bg:var(--primary)]',
    hoverClass: 'hover:[--block-bg:var(--primary-highlighted)]',
    ...containerCursors,
};

// ============= RESIZE HANDLES =============

/** Resize handle styles — invisible hit area, fills parent + 1px overflow */
export const resizeHandle = {
    base: 'absolute cursor-ew-resize z-30 flex items-center justify-center',
    width: 12,
};

/** Visible drag handle indicator that appears on hover */
export const dragHandleIndicator = {
    base: 'w-1 rounded-full transition-all duration-150 opacity-0 group-hover:opacity-100 border border-text-main/50',
    defaultClass: 'bg-primary-highlighted',
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
        boxShadow: 'var(--shadow-segment)',
        background: 'linear-gradient(to bottom, color-mix(in srgb, var(--block-bg) 100%, transparent), color-mix(in srgb, var(--block-bg) 75%, transparent))',
    };
}

/** Common semi-transparent shape for transition/fade segments */
export function transitionShapeBase(height: number = BASE_HEIGHT): CSSProperties {
    return {
        height,
        backgroundColor: 'color-mix(in srgb, var(--block-bg) 50%, transparent)',
    };
}

// ============= SEGMENT STYLES =============

/** Transition segment base class (used for zoom transition-in, spotlight fades, camera layout transitions) */
export const transitionSegment = {
    base: `absolute flex-shrink-0 ${blockBorder.base} ${blockBorder.highlighted} transition-colors z-[5]`,
    defaultClass: '',
    selectedClass: blockBorder.selected,
    hoverClass: '',
    getStyle: (): CSSProperties => transitionShapeBase(),
};

/** Hold segment base class (used for zoom hold, spotlight hold, camera layout hold) */
export const holdSegment = {
    base: `absolute flex-shrink-0 transition-colors z-10 ${blockBorder.base} ${blockBorder.highlighted}`,
    defaultClass: '',
    selectedClass: blockBorder.selected,
    hoverClass: '',
    getStyle: holdStyle,
};

// ============= SEGMENT STYLE GETTERS =============

/** Transition-in shape: left-rounded, semi-transparent, no right border */
export function transitionInStyle(): CSSProperties {
    return {
        ...transitionShapeBase(),
        borderRadius: `${SEGMENT_RADIUS}px 0 0 ${SEGMENT_RADIUS}px`,
        borderRight: 'none',
    };
}

/** Transition-out shape: right-rounded, semi-transparent, no left border */
export function transitionOutStyle(): CSSProperties {
    return {
        ...transitionShapeBase(),
        borderRadius: `0 ${SEGMENT_RADIUS}px ${SEGMENT_RADIUS}px 0`,
        borderLeft: 'none',
    };
}

/** Hold shape: solid fill, no border radius (inner edges) */
export function holdStyle(): CSSProperties {
    return {
        ...holdShapeBase(),
        borderRadius: 0,
    };
}


/** Spotlight fade shape: semi-transparent, no border radius, one border removed */
export function fadeStyle(side: 'left' | 'right'): CSSProperties {
    return {
        ...transitionShapeBase(20),
        borderRadius: 0,
        ...(side === 'left' ? { borderRight: 'none' } : { borderLeft: 'none' }),
    };
}

// ============= GHOST STYLES =============

/** Label class for ghost "add" indicators */
export const ghostLabel =
    'absolute bottom-[calc(100%+2px)] left-1/2 -translate-x-1/2 whitespace-nowrap text-[9px] text-secondary bg-black/90 px-1.5 py-0.5 rounded pointer-events-none';

/** Base container class for ghost blocks */
export const ghostContainerBase =
    'absolute pointer-events-none z-25 flex items-center [--block-bg:var(--secondary)]';

/** Ghost zoom block — transition-in + hold */
export const ghostZoom = {
    container: ghostContainerBase,
    label: ghostLabel,
    transitionIn: {
        className: blockBorder.base,
        getStyle: (): CSSProperties => transitionInStyle(),
    },
    hold: {
        className: blockBorder.base,
        getStyle: (): CSSProperties => ({
            ...holdStyle(),
            borderRadius: `0 ${SEGMENT_RADIUS}px ${SEGMENT_RADIUS}px 0`,
        }),
    },
};

/** Ghost spotlight block — fadeIn + hold + fadeOut */
export const ghostSpotlight = {
    container: ghostContainerBase,
    label: ghostLabel,
    fadeIn: {
        className: blockBorder.base,
        getStyle: (): CSSProperties => transitionShapeBase(),
    },
    hold: {
        className: blockBorder.base,
        getStyle: (): CSSProperties => holdStyle(),
    },
    fadeOut: {
        className: blockBorder.base,
        getStyle: (): CSSProperties => transitionShapeBase(),
    },
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

/** Ghost camera layout block — transitionIn + hold + transitionOut */
export const ghostCameraLayout = {
    container: ghostContainerBase,
    label: ghostLabel,
    transitionIn: {
        className: blockBorder.base,
        getStyle: (): CSSProperties => transitionInStyle(),
    },
    hold: {
        className: blockBorder.base,
        getStyle: (): CSSProperties => ({
            ...holdStyle(),
            borderRadius: 0,
        }),
    },
    transitionOut: {
        className: blockBorder.base,
        getStyle: (): CSSProperties => transitionOutStyle(),
    },
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
