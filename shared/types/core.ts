/**
 * Core primitive types shared between extension and webapp.
 */

import type { UserEvents } from './events';

// ==========================================
// PRIMITIVES
// ==========================================

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

// ==========================================
// SOURCE METADATA
// ==========================================

/**
 * Shared fields for all media source types.
 */
interface BaseSourceMetadata {
    id: ID;
    /**
     * Persistent local browser storage based URL to the media file (recordio-blob:// protocol).
     * This is the storage reference that survives page reloads.
     */
    storageUrl: string;
    /**
     * Transient runtime URL (blob:// protocol).
     * Populated on load, used for playback. Never persisted.
     */
    runtimeUrl?: string;

    /** Total duration of the source file in milliseconds */
    durationMs: TimeMs;
    createdAt?: number;
}

/**
 * Metadata for a screen recording source (tab, window, or screen capture).
 */
export interface ScreenMetadata extends BaseSourceMetadata {
    /**
     * Trackable content area within the video frame (JavaScript-monitored region).
     * For window recordings: x,y = offset from video frame origin to content area origin.
     * For tab recordings: x=0, y=0, width/height = full frame dimensions.
     * Absent for screen (desktop) recordings.
     */
    trackableContentRect?: Rect;
    hasAudio: boolean;
    size: Size;
    /** Actual negotiated frame rate from MediaRecorder (fps) */
    frameRate?: number;
}

/**
 * Metadata for a camera recording source.
 */
export interface CameraMetadata extends BaseSourceMetadata {
    size: Size;
    /** Actual negotiated frame rate from MediaRecorder (fps) */
    frameRate?: number;
}

/**
 * Metadata for a microphone audio source (standalone audio track).
 */
export interface MicrophoneMetadata extends BaseSourceMetadata { }

/** Union type for consumer code that handles both source types. */
export type SourceMetadata = ScreenMetadata | CameraMetadata;

// ==========================================
// RAW RECORDING (handoff format)
// ==========================================

/**
 * Lightweight recording data for handoff between extension and website.
 * This is NOT the full Project - it's the minimal data needed to create one.
 */
export interface RawRecording {
    id: string;
    name: string;
    timestamp: number; // createdAt timestamp

    screenSource: ScreenMetadata;
    cameraSource?: CameraMetadata;
    microphoneSource?: MicrophoneMetadata;
    userEvents: UserEvents;

    /** Post-processing preferences set during recording setup */
    recordingPreferences?: RecordingPreferences;
}

/** Preferences set in the controller during recording setup.
 *  These are hints for the editor to auto-apply on import. */
export interface RecordingPreferences {
    applyAutoZoom?: boolean;
    applySpotlight?: boolean;
    simplifyToolbar?: boolean;
}
