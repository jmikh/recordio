import type { BaseEvent } from '../core/types';

export type RecorderMode = 'desktop' | 'tab';

export type MessageSource = 'offscreen' | 'controller' | 'background' | 'content' | 'extension';
export type MessageTarget = 'background' | 'offscreen' | 'controller' | 'content' | 'extension';

export interface BaseMessage {
    type: string;
    source: MessageSource;
    target: MessageTarget;
    sessionId: string;
    timestamp: number;
    payload?: any;
}

// --- Message Types ---

export const MSG_TYPES = {
    // Session Management
    START_SESSION: 'START_SESSION',             // Controller/Offscreen -> Background (Register session)
    SESSION_STARTED: 'SESSION_STARTED',         // Background -> Controller/Offscreen (Ack)

    // Recording Control
    START_RECORDING: 'START_RECORDING',         // Background -> Offscreen/Controller
    RECORDING_STARTED: 'RECORDING_STARTED',     // Offscreen/Controller -> Background
    STOP_RECORDING: 'STOP_RECORDING',           // Background -> Offscreen/Controller
    RECORDING_STOPPED: 'RECORDING_STOPPED',     // Offscreen/Controller -> Background
    CANCEL_RECORDING: 'CANCEL_RECORDING',       // Background -> Offscreen/Controller
    RECORDING_CANCELLED: 'RECORDING_CANCELLED', // Offscreen/Controller -> Background

    // Status & Logs
    STATUS_UPDATE: 'STATUS_UPDATE',             // Offscreen/Controller -> Background
    ERROR_OCCURRED: 'ERROR_OCCURRED',           // Any -> Background

    // Content Script
    CAPTURE_USER_EVENT: 'CAPTURE_USER_EVENT',           // Content -> Background (User interactions)
    PREPARE_RECORDING: 'PREPARE_RECORDING',             // Background -> Content (Start countdown/calibration)
    RECORDING_READY: 'RECORDING_READY',                 // Content -> Background (Countdown done)

    // Coordination
    PING_OFFSCREEN: 'PING_OFFSCREEN',
    GET_RECORDING_STATE: 'GET_RECORDING_STATE',

    // Events (Forwarding)
    // ADD_USER_EVENT removed, reusing CAPTURE_USER_EVENT
} as const;

export type MessageTypeName = typeof MSG_TYPES[keyof typeof MSG_TYPES];

// --- Storage Keys ---

export const STORAGE_KEYS = {
    RECORDING_STATE: 'recording_state'
} as const;

// --- State Interfaces ---

export interface RecordingState {
    isRecording: boolean;
    recordingTabId: number | null;
    recorderEnvironmentId: number | null;
    startTime: number;
    currentSessionId: string | null;
    mode: RecorderMode | null;
}

// --- Payloads ---

export interface RecordingConfig {
    hasAudio: boolean;
    hasCamera: boolean;
    audioDeviceId?: string; // Microphone
    videoDeviceId?: string; // Camera
    tabViewportSize?: import('../core/types').Size; // Target dimensions (for window mode calibration)
    streamId?: string; // Required for tab recording
}

export interface StartSessionPayload {
    mode: RecorderMode;
}

export interface RecordingStartedPayload {
    startTime: number;
}

export interface RecordingStoppedPayload {
    blobId: string;
    durationMs: number;
    metadata: any;
}


export interface ErrorPayload {
    context: string;
    error: string;
    stack?: string;
}



export interface UserEventPayload extends BaseEvent {
    // Union of all user events (Mouse, Keyboard, etc.)
    // We import BaseEvent but really we pass the whole object.
    [key: string]: any;
}
