import type { CSSProperties } from 'react';

// ============================================================================
// ZOOM TRACK STYLES
// Centralized styling for zoom track visual elements.
// Used by ZoomKeyframe, ZoomLines, ZoomLegend, and ZoomTrack (ghost).
// ============================================================================

// ============= SIZE CONSTANTS =============

/** Size of keyframe markers (diamond and square) in pixels */
export const KEYFRAME_SIZE = 14;

/** Height of transition trail in pixels */
export const TRANSITION_HEIGHT = 5;

/** Height of hold line in pixels */
export const HOLD_HEIGHT = 2;

// ============= KEYFRAME STYLES =============

/** Diamond-shaped keyframe for zoomed states */
export const diamondKeyframe = {
    base: 'rotate-45 transition-all duration-150',
    default: 'bg-primary',
    selected: 'bg-secondary scale-110',
    hover: 'group-hover:bg-primary-highlighted group-hover:scale-110',
    style: {
        width: KEYFRAME_SIZE,
        height: KEYFRAME_SIZE,
        borderRadius: 1,
    } as CSSProperties,
};

/** Hollow square keyframe for full-viewport (1x) states */
export const squareKeyframe = {
    base: 'bg-surface-overlay transition-all duration-150',
    default: 'border-primary',
    selected: 'border-secondary scale-110',
    hover: 'group-hover:border-primary-highlighted group-hover:scale-110',
    style: {
        width: KEYFRAME_SIZE,
        height: KEYFRAME_SIZE,
        borderWidth: 2,
        borderRadius: 2,
        borderStyle: 'solid' as const,
    } as CSSProperties,
};

/** Container for keyframe markers */
export const keyframeContainer = {
    base: 'absolute top-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center group z-20',
    dragging: 'cursor-grabbing',
    idle: 'cursor-grab',
};

/** Scale label shown below keyframes */
export const scaleLabel = {
    className: 'absolute top-[calc(100%+4px)] whitespace-nowrap text-[8px] font-mono text-text-muted pointer-events-none select-none',
};

// ============= LINE STYLES =============

/** Transition trail - thicker line leading into a keyframe */
export const transitionTrail = {
    base: 'absolute top-1/2 -translate-y-1/2 rounded-full pointer-events-none z-10',
    default: 'bg-primary',
    selected: 'bg-secondary',
    opacity: 0.7,
    height: TRANSITION_HEIGHT,
};

/** Hold line - thin line between zoomed keyframes */
export const holdLine = {
    base: 'absolute top-1/2 -translate-y-1/2 pointer-events-none z-[5]',
    default: 'bg-primary',
    selected: 'bg-secondary',
    opacity: 0.5,
    height: HOLD_HEIGHT,
};

// ============= GHOST STYLES (Add Zoom indicator) =============

export const ghostKeyframe = {
    container: 'absolute top-1/2 -translate-x-1/2 -translate-y-1/2 z-25 pointer-events-none flex flex-col items-center',
    label: 'absolute bottom-[calc(100%+6px)] whitespace-nowrap text-[9px] text-secondary bg-black/90 px-1.5 py-0.5 rounded pointer-events-none',
    diamond: 'rotate-45 bg-secondary',
    diamondStyle: {
        width: KEYFRAME_SIZE,
        height: KEYFRAME_SIZE,
        borderRadius: 1,
    } as CSSProperties,
};

export const ghostTrail = {
    className: 'absolute top-1/2 -translate-y-1/2 rounded-full pointer-events-none z-15 bg-secondary',
    opacity: 0.5,
    height: TRANSITION_HEIGHT,
};

// ============= LEGEND STYLES =============

/** For use in ZoomLegend tooltip */
export const legendItem = {
    holdLine: {
        className: 'w-6 bg-primary opacity-50 rounded',
        style: { height: HOLD_HEIGHT } as CSSProperties,
    },
    transitionTrail: {
        className: 'w-6 bg-primary opacity-70 rounded-full',
        style: { height: TRANSITION_HEIGHT } as CSSProperties,
    },
    diamond: {
        className: 'bg-primary rotate-45',
        style: {
            width: KEYFRAME_SIZE,
            height: KEYFRAME_SIZE,
            borderRadius: 1,
        } as CSSProperties,
    },
    square: {
        className: 'border-primary bg-surface-overlay',
        style: {
            width: KEYFRAME_SIZE,
            height: KEYFRAME_SIZE,
            borderWidth: 2,
            borderRadius: 2,
            borderStyle: 'solid' as const,
        } as CSSProperties,
    },
};
