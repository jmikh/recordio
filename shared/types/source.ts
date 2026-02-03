/**
 * Source metadata types shared between extension and webapp.
 */

import type { ID, TimeMs, Size } from './core';

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
    /** Frames Per Second (Video only) */
    fps?: number;
    hasAudio: boolean;
    has_microphone: boolean;
    fileSizeBytes?: number;
    createdAt?: number;
    /** Human readable name of the source (e.g. Tab Title or "Desktop") */
    name: string;
}
