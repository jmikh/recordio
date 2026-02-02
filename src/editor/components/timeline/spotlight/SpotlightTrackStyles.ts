import type { CSSProperties } from 'react';

// ============================================================================
// SPOTLIGHT TRACK STYLES
// Centralized styling for spotlight track visual elements.
// Uses CSS variables (var(--primary), var(--secondary)) from design system.
// ============================================================================

// ============= SIZE CONSTANTS =============

/** Height of the fade in/out segments (shorter) */
export const FADE_HEIGHT = 20;

/** Height of the hold segment (taller) */
export const HOLD_HEIGHT = 28;

/** Corner radius for segments */
export const SEGMENT_RADIUS = 4;

// ============= STRIPE PATTERN =============

/**
 * Creates a diagonal stripe pattern for fade segments using CSS variables.
 * @param angle - Stripe angle (45 for fade-in, -45 for fade-out)
 * @param angle - Stripe angle (-45 for fade-in, 45 for fade-out)
 */
export function createStripePattern(angle: number): CSSProperties {
    // Always use primary colors for stripes
    const colorVar = 'var(--primary)';
    const bgColorVar = 'var(--surface-overlay)';

    return {
        background: `repeating-linear-gradient(
            ${angle}deg,
            ${colorVar} 0px,
            ${colorVar} 1px,
            ${bgColorVar} 1px,
            ${bgColorVar} 6px
        )`,
    };
}

// ============= SEGMENT STYLES =============

/** Fade In segment (left) - shorter with -45° stripes */
export const fadeInSegment = {
    base: 'absolute flex-shrink-0 border-2 transition-colors z-[5]',
    defaultClass: 'border-primary',
    selectedClass: 'border-secondary',
    hoverClass: 'group-hover:border-primary-highlighted',
    height: FADE_HEIGHT,
    getStyle: (): CSSProperties => ({
        height: FADE_HEIGHT,
        borderRadius: `${SEGMENT_RADIUS}px 0 0 ${SEGMENT_RADIUS}px`,
        borderRight: 'none',
        ...createStripePattern(-45),
    }),
};

/** Hold segment (center) - taller with solid fill, border when selected */
export const holdSegment = {
    base: 'absolute flex-shrink-0 bg-primary rounded-sm transition-colors z-10',
    defaultClass: '',
    selectedClass: 'ring-2 ring-secondary',
    hoverClass: 'group-hover:bg-primary-highlighted group-hover:scale-y-110',
    height: HOLD_HEIGHT,
    getStyle: (): CSSProperties => ({
        height: HOLD_HEIGHT,
        borderRadius: 0,
    }),
};

/** Fade Out segment (right) - shorter with 45° stripes */
export const fadeOutSegment = {
    base: 'absolute flex-shrink-0 border-2 transition-colors z-[5]',
    defaultClass: 'border-primary',
    selectedClass: 'border-secondary',
    hoverClass: 'group-hover:border-primary-highlighted',
    height: FADE_HEIGHT,
    getStyle: (): CSSProperties => ({
        height: FADE_HEIGHT,
        borderRadius: `0 ${SEGMENT_RADIUS}px ${SEGMENT_RADIUS}px 0`,
        borderLeft: 'none',
        ...createStripePattern(45),
    }),
};

// ============= CONTAINER STYLES =============

/** Container for the entire spotlight block */
export const spotlightContainer = {
    base: 'absolute flex items-center',
    dragging: 'cursor-grabbing',
    idle: 'cursor-grab',
};

/** Height of the visible drag handle indicator (taller than fade segments) */
export const DRAG_HANDLE_HEIGHT = 32;

/** Resize handle styles - hit area for resizing */
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

// ============= GHOST STYLES (Add Spotlight indicator) =============

/** Creates ghost stripe pattern using secondary color */
function createGhostStripePattern(angle: number): CSSProperties {
    return {
        background: `repeating-linear-gradient(
            ${angle}deg,
            var(--secondary) 0px,
            var(--secondary) 1px,
            transparent 1px,
            transparent 6px
        )`,
        opacity: 0.6,
    };
}

export const ghostSpotlight = {
    container: 'absolute pointer-events-none z-25 flex items-center',
    label: 'absolute bottom-[calc(100%+2px)] left-1/2 -translate-x-1/2 whitespace-nowrap text-[9px] text-secondary bg-black/90 px-1.5 py-0.5 rounded pointer-events-none',
    fadeIn: {
        className: 'bg-secondary/30 border-2 border-secondary border-r-0',
        getStyle: (): CSSProperties => ({
            height: FADE_HEIGHT,
            borderRadius: `${SEGMENT_RADIUS}px 0 0 ${SEGMENT_RADIUS}px`,
            ...createGhostStripePattern(-45),
        }),
    },
    hold: {
        className: 'bg-secondary',
        getStyle: (): CSSProperties => ({
            height: HOLD_HEIGHT,
            opacity: 0.6,
        }),
    },
    fadeOut: {
        className: 'bg-secondary/30 border-2 border-secondary border-l-0',
        getStyle: (): CSSProperties => ({
            height: FADE_HEIGHT,
            borderRadius: `0 ${SEGMENT_RADIUS}px ${SEGMENT_RADIUS}px 0`,
            ...createGhostStripePattern(45),
        }),
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
            ...createStripePattern(-45),
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
            ...createStripePattern(45),
        } as CSSProperties,
    },
};
