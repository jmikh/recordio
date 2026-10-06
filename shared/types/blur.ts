/**
 * Blur Types
 *
 * Data model for the blur track. A blur segment is a time range during which
 * one or more rectangular regions of the frame are blurred (e.g. to hide
 * sensitive data). Like zoom/spotlight/camera-move segments, blur segments
 * never overlap in time; a single segment holds as many regions as needed.
 *
 * Temporal anchoring is source-time (via TimeSegment).
 * All spatial coordinates are in OUTPUT pixels (pinned to the output viewport).
 */

import type { ID, Rect } from './core';
import type { TimeSegment } from './timeline';

/** One blurred rectangle within a blur segment. */
export interface BlurRegion {
    id: ID;
    /** Region to blur in OUTPUT coordinates */
    rectPx: Rect;
    /** Corner radius [tl, tr, br, bl] in output pixels */
    borderRadiusPx: [number, number, number, number];
}

/** A time range (non-overlapping with other blur segments) that blurs one or more regions. */
export interface BlurSegment extends TimeSegment {
    /** Blur intensity in output pixels, shared by every region in the segment */
    blurRadiusPx: number;
    /** Regions blurred while the segment is active (always at least one) */
    regions: BlurRegion[];
}
