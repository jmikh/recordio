/**
 * Timeline Types
 * 
 * Timeline, output windows, and temporal actions (zoom, spotlight).
 */

import type { ID, TimeMs, Rect } from '@shared/types';
import type { Captions } from './settings/captions';

// ==========================================
// FOCUS AREAS
// ==========================================

/**
 * Represents a focus area for zoom targeting.
 * Stored in Timeline and computed from user events.
 */
export interface FocusArea {
    timestamp: number;  // Output time when this focus area applies
    rect: Rect;         // The focus rectangle in source coordinates
    reason: string;     // Why this focus area was returned (event type, 'hover', or 'inactivity')
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

export interface ZoomAction {
    id: ID;
    outputEndTimeMs: TimeMs;
    durationMs: TimeMs;
    rect: Rect;
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
export interface SpotlightAction {
    id: ID;
    /** Output time when the spotlight starts (in output coordinate system) */
    outputStartTimeMs: TimeMs;
    /** Output time when the spotlight ends (in output coordinate system) */
    outputEndTimeMs: TimeMs;
    /** The rectangle to spotlight (in SOURCE video coordinates) */
    sourceRect: Rect;
    /** Border radius in pixels for each corner [topLeft, topRight, bottomRight, bottomLeft] (in OUTPUT coordinates) */
    borderRadius: [number, number, number, number];
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
    zoomActions: ZoomAction[];
    /** Spotlight action keyframes for spotlight effect (non-overlapping) */
    spotlightActions: SpotlightAction[];
    /** Optional caption data from webcam audio */
    captions?: Captions;
    /** Cached focus areas computed from user events and output windows */
    focusAreas: FocusArea[];
}
