/**
 * Timeline Types
 * 
 * Timeline, output windows, temporal actions (zoom, spotlight), and caption segments.
 */

import type { ID, TimeMs, Rect } from './core';
import type { EasingStyle } from './settings';

// Re-export overlay types (defined in their own file for complexity management)
export type { OverlayItemType, BaseOverlayItem, BlurOverlayItem, TextOverlayItem, ArrowOverlayItem, BorderOverlayItem, OverlayItem, OverlaySegment } from './overlay';

// ==========================================
// BASE SEGMENT INTERFACE
// ==========================================

/**
 * Base interface for all timeline segments (zoom, spotlight, caption).
 *
 * Source times are the source of truth — stored and edited in source time.
 * Output times are a cache — recomputed via recomputeOutputTimes() whenever
 * outputWindows change or a segment is written. Never edit output times directly.
 */
export interface TimeSegment {
    id: ID;
    /** Source time: original recording time, before cuts/speed */
    sourceStartTimeMs: TimeMs;
    sourceEndTimeMs: TimeMs;
    /** Cached output time. Recomputed when windows change. */
    outputStartTimeMs: TimeMs;
    outputEndTimeMs: TimeMs;
    /** False if this segment falls entirely within a cut window. */
    visible: boolean;
}

// ==========================================
// CAPTION SEGMENTS
// ==========================================

/**
 * A single word within a caption segment.
 * Extends TimeSegment so each word carries its own source/output timestamps
 * and participates in output-time recomputation like any other segment.
 */
export interface Word extends TimeSegment {
    word: string;
    /** When true, this word is hidden from the rendered caption (but stays in data). */
    hidden?: boolean;
}

/**
 * A transcribed caption segment.
 * Contains an array of Word objects — text is derived from words, never stored separately.
 * Timestamps are in source time (before window cuts and speed adjustments).
 * Output times are cached on the segment via recomputeOutputTimes().
 */
export interface CaptionSegment extends TimeSegment {
    words: Word[];
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
    /** Playback speed multiplier. 2.0 = 2x speed, 0.5 = 0.5x speed */
    speed: number;
}

// ==========================================
// ZOOM ACTIONS
// ==========================================

export interface ZoomSegment extends TimeSegment {
    /** Target viewport in OUTPUT coordinates (pixels) */
    rectPx: Rect;
    reason: string;
    type: 'auto' | 'manual';
    /** Transition duration for this zoom (inherited from global settings on creation) */
    transitionDurationMs: number;
    /** Easing curve for this zoom (inherited from global settings on creation) */
    easing: EasingStyle;
}

// ==========================================
// SPOTLIGHT ACTIONS
// ==========================================

/**
 * A spotlight action is a finite-duration effect that dims the background
 * and enlarges a specific region with smooth transitions.
 * The spotlight region is defined in SOURCE coordinates (original screen recording).
 */
export interface SpotlightSegment extends TimeSegment {
    /** The rectangle to spotlight (in SOURCE video coordinates) */
    sourceRect: Rect;
    /** Border radius in pixels for each corner [topLeft, topRight, bottomRight, bottomLeft] (in OUTPUT coordinates) */
    borderRadiusPx: [number, number, number, number];
    /** Scale factor for this spotlight (capped to fit within output bounds) */
    scale: number;
    /** Optional reason/label for the spotlight */
    reason?: string;
    /** Dim opacity for this spotlight (inherited from global settings on creation) */
    dimOpacity: number;
    /** Transition duration for this spotlight (inherited from global settings on creation) */
    transitionDurationMs: number;
    /** Easing curve for this spotlight (inherited from global settings on creation) */
    easing: EasingStyle;
}

// ==========================================
// CAMERA LAYOUT SEGMENTS
// ==========================================

/**
 * A camera layout segment overrides the default camera position, size,
 * shape, and border radius for a specific time range.
 * Source-time anchored for trim/speed stability.
 */
export interface CameraMoveSegment extends TimeSegment {
    /** Position X in output-space pixels */
    xPx: number;
    /** Position Y in output-space pixels */
    yPx: number;
    /** Width in output-space pixels */
    widthPx: number;
    /** Height in output-space pixels */
    heightPx: number;
    /** Shape override for this block */
    shape: 'circle' | 'rect' | 'square';
    /** Corner radius in output pixels for this block */
    borderRadiusPx: number;
    /** Whether the camera is hidden during this block */
    hidden?: boolean;
    /** Transition duration for entering this block (inherited from global on creation) */
    transitionDurationMs: number;
    /** Easing curve for this block's transition */
    easing: EasingStyle;
}

// ==========================================
// DISPLAY SETTINGS
// ==========================================

/**
 * Controls timeline track visibility and collapse behavior.
 * Persisted per-project as part of the Timeline.
 */
export interface DisplaySettings {
    showZoom: boolean;
    showSpotlight: boolean;
    showCaptions: boolean;
    showCameraMove: boolean;
    showOverlay: boolean;
    /** Whether hover-to-expand collapse is active */
    collapsed: boolean;
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
    /** Caption segments from camera audio transcription */
    captionSegments: CaptionSegment[];
    /** Camera layout overrides for dynamic camera position/size changes */
    cameraMoveSegments: CameraMoveSegment[];
    /** Overlay annotation segments (may overlap, single-item each, source-time anchored) */
    overlaySegments: import('./overlay').OverlaySegment[];
    /** Cached focus areas computed from user events and output windows */
    focusAreas: FocusArea[];
    /** Timeline display settings (track visibility, collapse state) */
    displaySettings: DisplaySettings;
}
