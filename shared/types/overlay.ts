/**
 * Overlay Item Types
 *
 * Annotation items (blur, text, arrow, border) drawn by the screenshot editor
 * (ScreenshotDoc.annotations). Video projects no longer carry overlays — they
 * use blur segments (./blur.ts) instead.
 * All spatial coordinates are in the host document's pixel space.
 */

import type { ID, Point, Rect } from './core';

// ==========================================
// OVERLAY ITEM TYPES
// ==========================================

/** Types of visual overlays */
export type OverlayItemType = 'blur' | 'text' | 'arrow' | 'border';

/** Visual effect applied to overlay items (shadow/glow are painter-derived from REF constants) */
export type OverlayEffect = 'none' | 'shadow' | 'glow';

/** Base overlay item within a segment */
export interface BaseOverlayItem {
    id: ID;
    type: OverlayItemType;
}

/** Blur mask — blurs a rectangular region */
export interface BlurOverlayItem extends BaseOverlayItem {
    type: 'blur';
    /** Region to blur in OUTPUT coordinates */
    rectPx: Rect;
    /** Blur intensity in pixels ('blur' mode) or pixel cell size ('pixelate' mode) */
    blurRadiusPx: number;
    /** Corner radius [tl, tr, br, bl] in output pixels */
    borderRadiusPx: [number, number, number, number];
    /** Obscuring style; absent = 'blur' (legacy items predate this field) */
    mode?: 'blur' | 'pixelate';
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
    /** Visual effect: shadow, glow, or none (params derived by painter) */
    effect: OverlayEffect;
    /** 'none' draws a plain line (no arrowhead); absent = 'arrow' */
    headStyle?: 'arrow' | 'none';
}

/** Border/outline overlay — draws a rectangular (or elliptical) outline */
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
    /** Visual effect: shadow, glow, or none (params derived by painter) */
    effect: OverlayEffect;
    /** 'ellipse' inscribes an ellipse in rectPx (borderRadiusPx ignored); absent = 'rect' */
    shape?: 'rect' | 'ellipse';
}

/** Union of all overlay item types */
export type OverlayItem = BlurOverlayItem | TextOverlayItem | ArrowOverlayItem | BorderOverlayItem;
