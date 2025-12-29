import type { BaseEvent } from '../core/types';

export type RecorderMode = 'desktop' | 'tab' | 'window';

export interface BaseMessage {
    type: string;
    payload?: any;
}

// --- Message Types ---

export const MSG_TYPES = {
    // Recording Control
    // Session Control (Extension -> Background)
    START_SESSION: 'START_SESSION',
    STOP_SESSION: 'STOP_SESSION',

    // Recording Control (Background -> Offscreen)
    START_RECORDING_VIDEO: 'START_RECORDING_VIDEO',     // Background -> Offscreen
    STOP_RECORDING_VIDEO: 'STOP_RECORDING_VIDEO',       // Background -> Offscreen

    START_RECORDING_EVENTS: 'START_RECORDING_EVENTS',   // Background -> Content
    STOP_RECORDING_EVENTS: 'STOP_RECORDING_EVENTS',     // Background -> Content

    // Content Script
    CAPTURE_USER_EVENT: 'CAPTURE_USER_EVENT',           // Content -> Background (User interactions)
    START_COUNTDOWN: 'START_COUNTDOWN',                 // Background -> Content (Start countdown/calibration)
    COUNTDOWN_DONE: 'COUNTDOWN_DONE',                   // Content -> Background (Countdown done)

    // Coordination
    PING_OFFSCREEN: 'PING_OFFSCREEN',
    PING_CONTROLLER: 'PING_CONTROLLER',
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
    sourceId?: string; // For desktop capture (window/desktop mode)
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
