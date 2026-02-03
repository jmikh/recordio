/**
 * Device Pixel Ratio (DPR) scaling utilities.
 * 
 * All coordinates captured from DOM events are in CSS pixels.
 * These utilities scale values to device pixels for video alignment.
 */

import type { Rect } from '../../core/types';

/**
 * Scale a point by the device pixel ratio.
 */
export function dprScalePoint(point: { x: number, y: number }): { x: number, y: number } {
    const dpr = window.devicePixelRatio || 1;
    return { x: point.x * dpr, y: point.y * dpr };
}

/**
 * Scale a rect by the device pixel ratio.
 */
export function dprScaleRect(rect: Rect): Rect {
    const dpr = window.devicePixelRatio || 1;
    return {
        x: rect.x * dpr,
        y: rect.y * dpr,
        width: rect.width * dpr,
        height: rect.height * dpr
    };
}

/**
 * Scale corner radius values by the device pixel ratio.
 * Accepts the [topLeft, topRight, bottomRight, bottomLeft] tuple format.
 */
export function dprScaleRadius(radius: [number, number, number, number]): [number, number, number, number] {
    const dpr = window.devicePixelRatio || 1;
    return [
        radius[0] * dpr,
        radius[1] * dpr,
        radius[2] * dpr,
        radius[3] * dpr
    ];
}
