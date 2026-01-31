/**
 * Pure geometry utilities for rectangles, points, and sizes.
 * These functions are lightweight and have no dependencies on coordinate remapping.
 */

import type { Rect, Point, Size } from './types';

// ============================================================================
// Configuration
// ============================================================================

/** Default factor to enlarge target rects by (0.1 = 10% bigger) */
export const DEFAULT_ENLARGE_FACTOR = 0.1;

// ============================================================================
// Rect Scaling
// ============================================================================

/**
 * Scales a rectangle from its center point.
 * @param rect The rectangle to scale
 * @param scale The scale factor (1.0 = no change, 1.1 = 10% bigger, 0.9 = 10% smaller)
 */
export function scaleRectFromCenter(rect: Rect, scale: number): Rect {
    const centerX = rect.x + rect.width / 2;
    const centerY = rect.y + rect.height / 2;
    const newWidth = rect.width * scale;
    const newHeight = rect.height * scale;

    return {
        x: centerX - newWidth / 2,
        y: centerY - newHeight / 2,
        width: newWidth,
        height: newHeight
    };
}

/**
 * Enlarges a rectangle by a given factor while maintaining its center.
 * @param rect The rectangle to enlarge
 * @param factor The enlargement factor (0.1 = 10% bigger). Defaults to DEFAULT_ENLARGE_FACTOR.
 */
export function enlargeRect(rect: Rect, factor: number = DEFAULT_ENLARGE_FACTOR): Rect {
    return scaleRectFromCenter(rect, 1 + factor);
}

// ============================================================================
// Rect Intersection & Containment
// ============================================================================

/**
 * Computes the intersection of two rectangles.
 * @returns The intersection rectangle, or null if they don't intersect
 */
export function getIntersection(r1: Rect, r2: Rect): Rect | null {
    const x = Math.max(r1.x, r2.x);
    const y = Math.max(r1.y, r2.y);
    const width = Math.min(r1.x + r1.width, r2.x + r2.width) - x;
    const height = Math.min(r1.y + r1.height, r2.y + r2.height) - y;

    if (width <= 0 || height <= 0) {
        return null;
    }
    return { x, y, width, height };
}

/**
 * Checks if the outer rectangle fully contains the inner rectangle.
 */
export function rectContainsRect(outer: Rect, inner: Rect): boolean {
    return (
        inner.x >= outer.x &&
        inner.y >= outer.y &&
        inner.x + inner.width <= outer.x + outer.width &&
        inner.y + inner.height <= outer.y + outer.height
    );
}

/**
 * Checks if a rectangle contains a point.
 */
export function rectContainsPoint(rect: Rect, point: Point): boolean {
    return (
        point.x >= rect.x &&
        point.x <= rect.x + rect.width &&
        point.y >= rect.y &&
        point.y <= rect.y + rect.height
    );
}

// ============================================================================
// Rect Clamping
// ============================================================================

/**
 * Clamps a rectangle to stay within bounds, potentially shrinking it.
 * Use this when the rect may extend outside the bounds and should be cropped.
 */
export function clampRectToBounds(rect: Rect, bounds: Size): Rect {
    const x = Math.max(0, rect.x);
    const y = Math.max(0, rect.y);
    const width = Math.min(rect.width, bounds.width - x);
    const height = Math.min(rect.height, bounds.height - y);

    return { x, y, width, height };
}

/**
 * Clamps a viewport to stay within bounds, preserving its size.
 * Use this for viewports that must stay the same size but need position adjustment.
 */
export function clampViewportToBounds(viewport: Rect, bounds: Size): Rect {
    let { x, y, width, height } = viewport;

    const maxX = bounds.width - width;
    if (x < 0) x = 0;
    else if (x > maxX) x = maxX;

    const maxY = bounds.height - height;
    if (y < 0) y = 0;
    else if (y > maxY) y = maxY;

    return { x, y, width, height };
}

// ============================================================================
// Rect Properties
// ============================================================================

/**
 * Gets the center point of a rectangle.
 */
export function getRectCenter(rect: Rect): Point {
    return {
        x: rect.x + rect.width / 2,
        y: rect.y + rect.height / 2
    };
}

/**
 * Creates a rectangle from a center point and size.
 */
export function rectFromCenter(center: Point, size: Size): Rect {
    return {
        x: center.x - size.width / 2,
        y: center.y - size.height / 2,
        width: size.width,
        height: size.height
    };
}

/**
 * Gets the area of a rectangle.
 */
export function getRectArea(rect: Rect): number {
    return rect.width * rect.height;
}
