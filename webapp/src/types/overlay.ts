/**
 * Overlay Types
 *
 * Data model for the overlay annotation system.
 * Overlays are visual annotations (blur, text, arrow, border) displayed on top of the video.
 * All spatial coordinates are in OUTPUT pixels (pinned to output viewport).
 * Temporal anchoring is source-time (via TimeSegment).
 */

import type { ID, Point, Rect } from '@shared/types';
import type { TimeSegment } from './timeline';

// ==========================================
// OVERLAY ITEM TYPES
// ==========================================

/** Types of visual overlays */
export type OverlayItemType = 'blur' | 'text' | 'arrow' | 'border';

/** Base overlay item within a block */
export interface BaseOverlayItem {
    id: ID;
    type: OverlayItemType;
}

/** Blur mask — blurs a rectangular region */
export interface BlurOverlayItem extends BaseOverlayItem {
    type: 'blur';
    /** Region to blur in OUTPUT coordinates */
    rectPx: Rect;
    /** Blur intensity in pixels */
    blurRadiusPx: number;
    /** Corner radius [tl, tr, br, bl] in output pixels */
    borderRadiusPx: [number, number, number, number];
}

/** Text label */
export interface TextOverlayItem extends BaseOverlayItem {
    type: 'text';
    /** Position (top-left) in OUTPUT coordinates */
    topLeft: Point;
    /** Text box width in output pixels (text wraps within this width) */
    widthPx: number;
    /** Text content */
    text: string;
    /** Font size in output pixels */
    fontSizePx: number;
    /** Font family name */
    fontFamily: string;
    /** Font weight (400 = normal, 700 = bold) */
    fontWeight: number;
    /** Text color (hex) */
    color: string;
    /** Optional background color (hex with alpha, e.g. '#000000cc') */
    backgroundColor?: string;
    /** Background padding in output pixels */
    backgroundPaddingPx: number;
    /** Background corner radius in output pixels */
    backgroundRadiusPx: number;
    /** Optional text stroke/outline color */
    strokeColor?: string;
    /** Stroke width in output pixels */
    strokeWidthPx: number;
    /** Optional drop shadow */
    shadow?: {
        color: string;
        blurPx: number;
        offsetXPx: number;
        offsetYPx: number;
    };
}

/** Arrow annotation */
export interface ArrowOverlayItem extends BaseOverlayItem {
    type: 'arrow';
    /** Tail (start) position in OUTPUT coordinates */
    tail: Point;
    /** Head (tip) position in OUTPUT coordinates */
    head: Point;
    /** Stroke width in output pixels */
    strokeWidthPx: number;
    /** Arrow color (hex) */
    color: string;
    /** Arrowhead size multiplier (1.0 = default) */
    headScale: number;
    /** Optional drop shadow */
    shadow?: {
        color: string;
        blurPx: number;
        offsetXPx: number;
        offsetYPx: number;
    };
    /** Optional glow */
    glow?: {
        color: string;
        blurPx: number;
    };
}

/** Border/outline overlay — draws a rectangular outline */
export interface BorderOverlayItem extends BaseOverlayItem {
    type: 'border';
    /** Region to outline in OUTPUT coordinates */
    rectPx: Rect;
    /** Border width in output pixels */
    borderWidthPx: number;
    /** Border color (hex) */
    color: string;
    /** Corner radius [tl, tr, br, bl] in output pixels */
    borderRadiusPx: [number, number, number, number];
    /** Fill style: translucent fill color */
    fillColor?: string;
    /** Optional glow */
    glow?: {
        color: string;
        blurPx: number;
    };
    /** Optional drop shadow */
    shadow?: {
        color: string;
        blurPx: number;
        offsetXPx: number;
        offsetYPx: number;
    };
}

/** Union of all overlay item types */
export type OverlayItem = BlurOverlayItem | TextOverlayItem | ArrowOverlayItem | BorderOverlayItem;

/**
 * An overlay block is a time segment containing one or more visual overlays.
 * Non-overlapping with other overlay blocks (Option 2).
 * Source-time anchored for trim/speed stability.
 */
export interface OverlayBlock extends TimeSegment {
    /** The overlay items in this block */
    items: OverlayItem[];
}
