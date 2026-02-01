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
    const bgColorVar = 'var(--primary-muted)';

    return {
        background: `repeating-linear-gradient(
            ${angle}deg,
            ${colorVar} 0px,
            ${colorVar} 3px,
            ${bgColorVar} 3px,
            ${bgColorVar} 8px
        )`,
    };
}

// ============= SEGMENT STYLES =============

/** Fade In segment (left) - shorter with -45° stripes */
export const fadeInSegment = {
    base: 'absolute flex-shrink-0 border-2 transition-colors',
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
    base: 'absolute flex-shrink-0 bg-primary transition-colors',
    defaultClass: '',
    selectedClass: 'ring-2 ring-secondary',
    hoverClass: 'group-hover:bg-primary-highlighted',
    height: HOLD_HEIGHT,
    getStyle: (): CSSProperties => ({
        height: HOLD_HEIGHT,
        borderRadius: 0,
    }),
};

/** Fade Out segment (right) - shorter with 45° stripes */
export const fadeOutSegment = {
    base: 'absolute flex-shrink-0 border-2 transition-colors',
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

/** Resize handle styles */
export const resizeHandle = {
    base: 'absolute top-0 bottom-0 cursor-ew-resize z-10',
    width: 8,
    hoverClass: 'hover:bg-white/20',
};

// ============= GHOST STYLES (Add Spotlight indicator) =============

/** Creates ghost stripe pattern - lighter/more transparent version */
function createGhostStripePattern(angle: number): CSSProperties {
    return {
        background: `repeating-linear-gradient(
            ${angle}deg,
            var(--primary) 0px,
            var(--primary) 2px,
            transparent 2px,
            transparent 6px
        )`,
        opacity: 0.4,
    };
}

export const ghostSpotlight = {
    container: 'absolute pointer-events-none z-[6] flex items-center',
    fadeIn: {
        className: 'border-2 border-dashed border-primary/60',
        getStyle: (): CSSProperties => ({
            height: FADE_HEIGHT,
            borderRadius: `${SEGMENT_RADIUS}px 0 0 ${SEGMENT_RADIUS}px`,
            borderRight: 'none',
            ...createGhostStripePattern(-45),
        }),
    },
    hold: {
        className: 'border-2 border-dashed border-primary/60 flex items-center justify-center',
        getStyle: (): CSSProperties => ({
            height: HOLD_HEIGHT,
            backgroundColor: 'var(--primary)',
            opacity: 0.4,
        }),
    },
    fadeOut: {
        className: 'border-2 border-dashed border-primary/60',
        getStyle: (): CSSProperties => ({
            height: FADE_HEIGHT,
            borderRadius: `0 ${SEGMENT_RADIUS}px ${SEGMENT_RADIUS}px 0`,
            borderLeft: 'none',
            ...createGhostStripePattern(45),
        }),
    },
    label: 'text-[10px] text-primary pointer-events-none whitespace-nowrap',
};

// ============= LEGEND STYLES =============

export const legendItem = {
    fadeIn: {
        className: 'border border-primary',
        style: {
            width: 16,
            height: 12,
            borderRadius: `${SEGMENT_RADIUS}px 0 0 ${SEGMENT_RADIUS}px`,
            borderRight: 'none',
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
            borderLeft: 'none',
            ...createStripePattern(45),
        } as CSSProperties,
    },
};
