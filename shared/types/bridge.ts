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
    source: 'screen' | 'camera';
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

/** Origin of the editor website (production) */
export const EDITOR_ORIGIN_PROD = 'https://app.recordio.cc';

/** Origin of the editor website (development) */
export const EDITOR_ORIGIN_DEV = 'http://localhost:3001';

/** Get the appropriate editor origin based on environment */
export function getEditorOrigin(): string {
    // __DEV_MODE__ is defined in vite.config.ts based on build mode:
    // - `npm run dev` or `npm run build:extension:dev` → __DEV_MODE__ = true
    // - `npm run build:extension` → __DEV_MODE__ = false
    // @ts-expect-error __DEV_MODE__ is defined by Vite at build time
    if (__DEV_MODE__) {
        return EDITOR_ORIGIN_DEV;
    }
    return EDITOR_ORIGIN_PROD;
}

/** Build URL for import page */
export function buildImportUrl(recordingId: string): string {
    return `${getEditorOrigin()}${IMPORT_PATH}?id=${recordingId}`;
}
