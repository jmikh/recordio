/**
 * @fileoverview Message Types and Interfaces
 * 
 * Defines all message type constants and interfaces for cross-context communication
 * between the background service worker, content scripts, and controller page.
 * 
 * Message flow:
 *   Icon Click → Background → Opens Controller Tab
 *   Controller Tab ↔ Content Scripts (direct via chrome.runtime messaging)
 *   Controller Tab → Background (state updates)
 *   Icon Click (during recording) → Background → STOP_SESSION → Controller
 */

import type { BaseEvent, Size } from '@shared/types';


export interface BaseMessage {
    type: string;
    payload?: any;
}

// --- Message Types ---

export const MSG_TYPES = {
    // Session Control
    STOP_SESSION: 'STOP_SESSION',

    // Recording Events (Controller ↔ Content Scripts)
    START_RECORDING_EVENTS: 'START_RECORDING_EVENTS',   // Controller → Content (broadcast)
    STOP_RECORDING_EVENTS: 'STOP_RECORDING_EVENTS',     // Controller → Content (broadcast)

    // Content Script
    CAPTURE_USER_EVENT: 'CAPTURE_USER_EVENT',           // Content → Controller (User interactions)

    // State
    GET_RECORDING_STATE: 'GET_RECORDING_STATE',

    // Controller ↔ Background
    CONTROLLER_STARTED_RECORDING: 'CONTROLLER_STARTED_RECORDING', // Controller → Background (recording began)
    CONTROLLER_STOPPED_RECORDING: 'CONTROLLER_STOPPED_RECORDING', // Controller → Background (recording finished)
} as const;

export type MessageTypeName = typeof MSG_TYPES[keyof typeof MSG_TYPES];

// --- Storage Keys ---

export const STORAGE_KEYS = {
    RECORDING_STATE: 'recording_state'
} as const;

// --- State Interfaces ---

export interface RecordingState {
    isRecording: boolean;
    controllerTabId: number | null;
    startTime: number;
    currentSessionId: string | null;
    isCurrentWindow: boolean;
    originalTabId: number | null;
    hasAudio: boolean;
    hasCamera: boolean;
}

// --- Payloads ---

export interface RecordingConfig {
    hasAudio: boolean;
    hasCamera: boolean;
    audioDeviceId?: string; // Microphone
    videoDeviceId?: string; // Camera
    tabViewportSize?: Size; // CSS pixel dimensions of the controller viewport (for detection scaling)
    displayStream?: MediaStream; // The actual pre-captured MediaStream (replaces sourceId)
    sourceName?: string; // Human readable name (e.g. window title)
}

export interface UserEventPayload extends BaseEvent {
    // Union of all user events (Mouse, Keyboard, etc.)
    // We import BaseEvent but really we pass the whole object.
    [key: string]: any;
}
