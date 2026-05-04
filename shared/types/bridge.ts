/**
 * Bridge Types
 * 
 * Types for communication between extension and website via externally_connectable.
 * 
 * Protocol Overview:
 * 1. Website sends HANDOFF_REQUEST via sendMessage → Extension responds with metadata
 * 2. Website opens Port via chrome.runtime.connect for streaming
 * 3. Extension streams video chunks via Port (10MB each to stay under 64MB limit)
 * 4. Website reconstructs blobs and confirms via HANDOFF_COMPLETE
 */

import type { RawRecording } from './core';

// ============================================
// Message Types (sendMessage-based)
// ============================================

export const BRIDGE_MSG = {
    /** Website → Extension: Request recording metadata */
    HANDOFF_REQUEST: 'HANDOFF_REQUEST',
    /** Website → Extension: Confirm storage complete, extension can delete */
    HANDOFF_COMPLETE: 'HANDOFF_COMPLETE',
    /** Website → Extension: Open the controller tab for a new recording */
    OPEN_CONTROLLER: 'OPEN_CONTROLLER',
} as const;

export type BridgeMessageType = typeof BRIDGE_MSG[keyof typeof BRIDGE_MSG];

// ============================================
// Port Message Types (streaming)
// ============================================

export const PORT_MSG = {
    /** Website → Extension: Start streaming chunks */
    START_STREAM: 'START_STREAM',
    /** Extension → Website: A chunk of video data */
    CHUNK: 'CHUNK',
    /** Extension → Website: All chunks sent */
    STREAM_COMPLETE: 'STREAM_COMPLETE',
    /** Extension → Website: Streaming error */
    STREAM_ERROR: 'STREAM_ERROR',
} as const;

export type PortMessageType = typeof PORT_MSG[keyof typeof PORT_MSG];

/** Port name for video streaming */
export const HANDOFF_PORT_NAME = 'recordio-handoff';

/** Chunk size for streaming (10MB - safe under 64MB limit) */
export const CHUNK_SIZE = 10 * 1024 * 1024;

// ============================================
// Payloads for sendMessage
// ============================================

/** Website → Extension: Request handoff */
export interface HandoffRequestPayload {
    recordingId: string;
}

/** Extension → Website: Direct response to HANDOFF_REQUEST */
export interface HandoffMetadataResponse {
    success: true;
    recording: RawRecording;
    screenVideoSize: number;      // bytes
    screenVideoType: string;      // MIME type
    cameraVideoSize?: number;     // bytes (optional)
    cameraVideoType?: string;     // MIME type (optional)
    micAudioSize?: number;        // bytes (optional)
    micAudioType?: string;        // MIME type (optional)
    extensionDistinctId?: string; // Mixpanel anonymous ID for identity linking
}

/** Extension → Website: Error response */
export interface HandoffErrorResponse {
    success: false;
    error: string;
    code: 'NOT_FOUND' | 'STORAGE_ERROR' | 'UNKNOWN';
}

export type HandoffRequestResponse = HandoffMetadataResponse | HandoffErrorResponse;

/** Website → Extension: Confirm storage complete */
export interface HandoffCompletePayload {
    recordingId: string;
    projectId: string;
}

// ============================================
// Payloads for Port streaming
// ============================================

/** Website → Extension: Start streaming request */
export interface StartStreamPayload {
    recordingId: string;
}

/** Extension → Website: A chunk of video data */
export interface ChunkPayload {
    source: 'screen' | 'camera' | 'mic';
    index: number;
    total: number;
    data: number[];  // ArrayBuffer as number[] for structured clone
}

/** Extension → Website: Stream complete */
export interface StreamCompletePayload {
    recordingId: string;
}

/** Extension → Website: Stream error */
export interface StreamErrorPayload {
    error: string;
}

// ============================================
// Configuration
// ============================================

/** URL path where website handles imports */
export const IMPORT_PATH = '/import';

/** Timeout for handoff to complete (ms) */
export const HANDOFF_TIMEOUT_MS = 30000;

import { EDITOR_ORIGIN_PROD, EDITOR_ORIGIN_DEV } from '../urls';
export { CDN_ORIGIN, MARKETING_ORIGIN, SUPPORT_EMAIL, CHROME_EXTENSION_URL, EDITOR_ORIGIN_PROD, EDITOR_ORIGIN_DEV } from '../urls';

/** Get the appropriate editor origin based on environment.
 *  - `npm run build:extension` → production origin
 *  - `npm run build:extension:dev` → localhost (unless USE_PROD_ORIGIN=true)
 *  - `npm run dev` → localhost (unless USE_PROD_ORIGIN=true)
 */
export function getEditorOrigin(): string {
    // @ts-expect-error __DEV_MODE__ is defined by Vite at build time
    if (__DEV_MODE__) {
        // @ts-expect-error __USE_PROD_ORIGIN__ is defined by Vite at build time
        return __USE_PROD_ORIGIN__ ? EDITOR_ORIGIN_PROD : EDITOR_ORIGIN_DEV;
    }
    return EDITOR_ORIGIN_PROD;
}

/** Build URL for import page. Includes the extension's own ID so the webapp
 *  can connect back without hardcoding it. */
export function buildImportUrl(recordingId: string, extensionId: string): string {
    return `${getEditorOrigin()}${IMPORT_PATH}?id=${recordingId}&ext=${extensionId}`;
}
