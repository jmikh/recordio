/**
 * Bridge Types
 * 
 * Types for communication between extension and website via externally_connectable.
 */

import type { RawRecording } from './recording';

// ============================================
// Message Types
// ============================================

export const BRIDGE_MSG = {
    /** Sent by website when it's ready to receive a recording */
    BRIDGE_READY: 'BRIDGE_READY',
    /** Sent by extension with the full recording data */
    HANDOFF_RECORDING: 'HANDOFF_RECORDING',
    /** Sent by website to confirm storage complete */
    HANDOFF_COMPLETE: 'HANDOFF_COMPLETE',
    /** Sent on error */
    HANDOFF_ERROR: 'HANDOFF_ERROR',
} as const;

export type BridgeMessageType = typeof BRIDGE_MSG[keyof typeof BRIDGE_MSG];

// ============================================
// Payloads
// ============================================

/** Sent by website when ready */
export interface BridgeReadyPayload {
    recordingId: string;
}

/** Blob data in a serializable format for message passing */
export interface SerializedBlobData {
    buffer: number[];  // Uint8Array converted to number array
    type: string;      // MIME type
}

/** Sent by extension with the full recording data */
export interface HandoffRecordingPayload {
    recording: RawRecording;
    // Blobs are sent as serialized data (Blobs can't be sent through chrome.runtime.sendMessage)
    screenData: SerializedBlobData;
    cameraData?: SerializedBlobData;
}

/** Sent by website to confirm storage complete */
export interface HandoffCompletePayload {
    recordingId: string;
    projectId: string;
}

/** Sent on error */
export interface HandoffErrorPayload {
    recordingId: string;
    error: string;
    code: 'NOT_FOUND' | 'STORAGE_ERROR' | 'TIMEOUT' | 'UNKNOWN';
}

// ============================================
// Configuration
// ============================================

/** URL path where website handles imports */
export const IMPORT_PATH = '/import';

/** Timeout for handoff to complete (ms) */
export const HANDOFF_TIMEOUT_MS = 30000;

/** Origin of the editor website (production) */
export const EDITOR_ORIGIN_PROD = 'https://editor.recordio.site';

/** Origin of the editor website (development) */
export const EDITOR_ORIGIN_DEV = 'http://localhost:3001';

/** Get the appropriate editor origin based on environment */
export function getEditorOrigin(): string {
    // In development, use localhost
    // In production, use the real domain
    // We detect by checking if we're in a dev build
    if (typeof chrome !== 'undefined' && chrome.runtime?.getManifest) {
        const manifest = chrome.runtime.getManifest();
        // Development builds typically don't have update_url
        if (!manifest.update_url) {
            return EDITOR_ORIGIN_DEV;
        }
    }
    return EDITOR_ORIGIN_PROD;
}

/** Build URL for import page */
export function buildImportUrl(recordingId: string): string {
    return `${getEditorOrigin()}${IMPORT_PATH}?id=${recordingId}`;
}
