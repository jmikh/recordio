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
 * @param isSelected - Whether the spotlight is selected
 */
export function createStripePattern(angle: number, isSelected: boolean): CSSProperties {
    // Use CSS variables for colors
    const colorVar = isSelected ? 'var(--secondary)' : 'var(--primary)';
    const bgColorVar = isSelected ? 'var(--secondary-muted)' : 'var(--primary-muted)';

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
    base: 'absolute flex-shrink-0 border-2',
    defaultClass: 'border-primary',
    selectedClass: 'border-secondary',
    height: FADE_HEIGHT,
    getStyle: (isSelected: boolean): CSSProperties => ({
        height: FADE_HEIGHT,
        borderRadius: `${SEGMENT_RADIUS}px 0 0 ${SEGMENT_RADIUS}px`,
        borderRight: 'none',
        ...createStripePattern(-45, isSelected),
    }),
};

/** Hold segment (center) - taller with solid fill */
export const holdSegment = {
    base: 'absolute flex-shrink-0',
    defaultClass: 'bg-primary',
    selectedClass: 'bg-secondary',
    height: HOLD_HEIGHT,
    getStyle: (): CSSProperties => ({
        height: HOLD_HEIGHT,
        borderRadius: 0,
    }),
};

/** Fade Out segment (right) - shorter with 45° stripes */
export const fadeOutSegment = {
    base: 'absolute flex-shrink-0 border-2',
    defaultClass: 'border-primary',
    selectedClass: 'border-secondary',
    height: FADE_HEIGHT,
    getStyle: (isSelected: boolean): CSSProperties => ({
        height: FADE_HEIGHT,
        borderRadius: `0 ${SEGMENT_RADIUS}px ${SEGMENT_RADIUS}px 0`,
        borderLeft: 'none',
        ...createStripePattern(45, isSelected),
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

export const ghostSpotlight = {
    container: 'absolute pointer-events-none z-[6] flex items-center',
    fadeIn: {
        className: 'border-2 border-dashed border-primary/60',
        getStyle: (): CSSProperties => ({
            height: FADE_HEIGHT,
            borderRadius: `${SEGMENT_RADIUS}px 0 0 ${SEGMENT_RADIUS}px`,
            borderRight: 'none',
            backgroundColor: 'var(--primary-muted)',
        }),
    },
    hold: {
        className: 'border-2 border-dashed border-primary/60 flex items-center justify-center',
        getStyle: (): CSSProperties => ({
            height: HOLD_HEIGHT,
            backgroundColor: 'var(--primary-muted)',
        }),
    },
    fadeOut: {
        className: 'border-2 border-dashed border-primary/60',
        getStyle: (): CSSProperties => ({
            height: FADE_HEIGHT,
            borderRadius: `0 ${SEGMENT_RADIUS}px ${SEGMENT_RADIUS}px 0`,
            borderLeft: 'none',
            backgroundColor: 'var(--primary-muted)',
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
            ...createStripePattern(-45, false),
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
            ...createStripePattern(45, false),
        } as CSSProperties,
    },
};
