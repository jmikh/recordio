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
 * Represents a raw media asset (File) that has been imported.
 */
export interface SourceMetadata {
    id: ID;
    type: 'video' | 'audio' | 'image';
    /**
     * Persistent URL to the media file (recordio-blob:// protocol).
     * This is the storage reference that survives page reloads.
     */
    storageUrl: string;
    /**
     * Transient runtime URL (blob:// protocol).
     * Populated on load, used for playback. Never persisted.
     */
    runtimeUrl?: string;

    // Metadata
    /** Total duration of the source file in milliseconds */
    durationMs: TimeMs;
    size: Size;
    /**
     * Viewport region within the video frame (window recordings only).
     * x,y = offset from video frame origin to viewport origin.
     * width,height = viewport dimensions in video pixels.
     * Absent for tab recordings (viewport IS the full frame).
     */
    viewportRect?: Rect;
    /** Frames Per Second (Video only) */
    fps?: number;
    hasAudio: boolean;
    has_microphone: boolean;
    fileSizeBytes?: number;
    createdAt?: number;
    /** Human readable name of the source (e.g. Tab Title or "Desktop") */
    name: string;
}

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

    screenSource: SourceMetadata;
    cameraSource?: SourceMetadata;
    userEvents: UserEvents;
}
