/**
 * Core primitive types shared between extension and webapp.
 */

export type ID = string;

/**
 * Represents time in Milliseconds.
 * All time values use this unit.
 */
export type TimeMs = number;

export interface Point {
    x: number;
    y: number;
}

export interface Size {
    width: number;
    height: number;
}

// The rect point represents the top-left corner.
export interface Rect extends Point, Size { }
