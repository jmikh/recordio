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
} from '../TimelineBlockStyles';

// ============================================================================
// SPOTLIGHT TRACK STYLES
// Centralized styling for spotlight track visual elements.
//
// Color is driven by the CSS variable --block-bg, set on the container.
// Hover changes --block-bg to primary-highlighted, cascading to all children.
// ============================================================================

// ============= SIZE CONSTANTS =============

/** Height of the fade in/out segments (shorter) */
export const FADE_HEIGHT = 20;

/** Height of the hold segment (taller) */
export const HOLD_HEIGHT = 28;

/** Height of the visible drag handle indicator (taller than fade segments) */
export const DRAG_HANDLE_HEIGHT = 32;

// Re-export shared values used by components
export { SEGMENT_RADIUS };

// ============= SHARED SHAPE HELPERS =============

/** Fade shape: semi-transparent fill, rounded on one side */
function fadeShape(side: 'left' | 'right'): CSSProperties {
    const isLeft = side === 'left';
    return {
        ...transitionShapeBase(FADE_HEIGHT),
        borderRadius: isLeft
            ? `${SEGMENT_RADIUS}px 0 0 ${SEGMENT_RADIUS}px`
            : `0 ${SEGMENT_RADIUS}px ${SEGMENT_RADIUS}px 0`,
        ...(isLeft ? { borderRight: 'none' } : { borderLeft: 'none' }),
    };
}

/** Hold shape: solid fill with shadow */
function holdShape(): CSSProperties {
    return {
        ...holdShapeBase(HOLD_HEIGHT),
        borderRadius: SEGMENT_RADIUS,
    };
}

// ============= CONTAINER STYLES =============

/** Container for the entire spotlight block */
export const spotlightContainer = {
    base: 'absolute flex items-center [--block-bg:var(--primary)]',
    hoverClass: 'hover:[--block-bg:var(--primary-highlighted)]',
    ...containerCursors,
};

// ============= SEGMENT STYLES =============

/** Fade In segment (left) - shorter with semi-transparent fill */
export const fadeInSegment = {
    base: 'absolute flex-shrink-0 border-2 border-[var(--block-bg)] transition-colors z-[5]',
    defaultClass: '',
    selectedClass: 'border-secondary',
    hoverClass: '',
    height: FADE_HEIGHT,
    getStyle: (): CSSProperties => fadeShape('left'),
};

/** Hold segment (center) - taller with solid fill, border when selected */
export const holdSegment = {
    base: 'absolute flex-shrink-0 rounded-sm transition-colors z-10',
    defaultClass: '',
    selectedClass: 'border-2 border-secondary',
    hoverClass: '',
    height: HOLD_HEIGHT,
    getStyle: (): CSSProperties => holdShape(),
};

/** Fade Out segment (right) - shorter with semi-transparent fill */
export const fadeOutSegment = {
    base: 'absolute flex-shrink-0 border-2 border-[var(--block-bg)] transition-colors z-[5]',
    defaultClass: '',
    selectedClass: 'border-secondary',
    hoverClass: '',
    height: FADE_HEIGHT,
    getStyle: (): CSSProperties => fadeShape('right'),
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

// ============= GHOST STYLES (Add Spotlight indicator) =============

export const ghostSpotlight = {
    container: ghostContainerBase,
    label: ghostLabel,
    fadeIn: {
        className: 'border-2 border-[var(--block-bg)]',
        getStyle: (): CSSProperties => fadeShape('left'),
    },
    hold: {
        className: '',
        getStyle: (): CSSProperties => holdShape(),
    },
    fadeOut: {
        className: 'border-2 border-[var(--block-bg)]',
        getStyle: (): CSSProperties => fadeShape('right'),
    },
};

// ============= LEGEND STYLES =============

export const legendItem = {
    fadeIn: {
        className: 'border border-primary',
        style: {
            width: 16,
            height: 12,
            borderRadius: `${SEGMENT_RADIUS}px 0 0 ${SEGMENT_RADIUS}px`,
            backgroundColor: 'color-mix(in srgb, var(--primary) 50%, transparent)',
        } as CSSProperties,
    },
    hold: {
        className: 'bg-primary',
        style: {
            width: 20,
            height: 16,
        } as CSSProperties,
    },
    fadeOut: {
        className: 'border border-primary',
        style: {
            width: 16,
            height: 12,
            borderRadius: `0 ${SEGMENT_RADIUS}px ${SEGMENT_RADIUS}px 0`,
            backgroundColor: 'color-mix(in srgb, var(--primary) 50%, transparent)',
        } as CSSProperties,
    },
};
