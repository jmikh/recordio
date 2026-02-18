/**
 * Timeline Types
 * 
 * Timeline, output windows, temporal actions (zoom, spotlight), and caption segments.
 */

import type { ID, TimeMs, Rect } from '@shared/types';

// ==========================================
// BASE BLOCK INTERFACES
// ==========================================

/**
 * Base interface for any timeline action stored in source time.
 * Source time is the original recording time, before cuts and speed adjustments.
 */
export interface SourceTimeSegment {
    id: ID;
    sourceStartTimeMs: TimeMs;
    sourceEndTimeMs: TimeMs;
}

// ==========================================
// CAPTION SEGMENTS
// ==========================================

/**
 * A transcribed caption segment.
 * Timestamps are in source timeline time (before window cuts and speed adjustments).
 * The caption painter uses CaptionTimeMapper to convert to output time at render.
 */
export interface CaptionSegment extends SourceTimeSegment {
    text: string;
}

// ==========================================
// FOCUS AREAS
// ==========================================

/**
 * Represents a focus area for zoom targeting.
 * Stored in Timeline and computed from user events.
 */
export interface FocusArea {
    sourceStartTimeMs: number;  // Source time when this focus area starts
    sourceEndTimeMs: number;    // Source time when this focus area ends
    rect: Rect;                 // The focus rectangle in source coordinates
    reason: string;             // Why this focus area was returned (event type or 'hover')
}

// ==========================================
// OUTPUT WINDOWS
// ==========================================

/**
 * Defines a segment of the timeline that will be included in the final output.
 */
export interface OutputWindow {
    id: ID;
    /** Timeline-based start time */
    startMs: TimeMs;
    /** Timeline-based end time */
    endMs: TimeMs;
    /** Playback speed multiplier (default: 1.0). 2.0 = 2x speed, 0.5 = 0.5x speed */
    speed?: number;
}

// ==========================================
// ZOOM ACTIONS
// ==========================================

export interface ZoomSegment extends SourceTimeSegment {
    /** Target viewport in OUTPUT coordinates (pixels) */
    rectPx: Rect;
    reason: string;
    type: 'auto' | 'manual';
}

// ==========================================
// SPOTLIGHT ACTIONS
// ==========================================

/**
 * A spotlight action is a finite-duration effect that dims the background
 * and enlarges a specific region with smooth transitions.
 * The spotlight region is defined in SOURCE coordinates (original screen recording).
 */
export interface SpotlightSegment extends SourceTimeSegment {
    /** The rectangle to spotlight (in SOURCE video coordinates) */
    sourceRect: Rect;
    /** Border radius in pixels for each corner [topLeft, topRight, bottomRight, bottomLeft] (in OUTPUT coordinates) */
    borderRadiusPx: [number, number, number, number];
    /** Scale factor for this spotlight (capped to fit within output bounds) */
    scale: number;
    /** Optional reason/label for the spotlight */
    reason?: string;
}

// ==========================================
// TIMELINE
// ==========================================

/**
 * A Timeline represents the sequence of events.
 * It contains output windows and temporal actions.
 */
export interface Timeline {
    id: ID;
    /** Total duration of the timeline in milliseconds */
    durationMs: TimeMs;

    /**
     * Ordered non-overlapping windows of time fitting inside duration 
     * that will be outputted in the final video.
     * Defaulted to screenSource duration.
     */
    outputWindows: OutputWindow[];

    /** Zoom action keyframes for zoom/pan effects */
    zoomSegments: ZoomSegment[];
    /** Spotlight action keyframes for spotlight effect (non-overlapping) */
    spotlightSegments: SpotlightSegment[];
    /** Caption segments from webcam audio transcription */
    captionSegments: CaptionSegment[];
    /** Cached focus areas computed from user events and output windows */
    focusAreas: FocusArea[];
}
