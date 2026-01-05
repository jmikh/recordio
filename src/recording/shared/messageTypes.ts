/**
 * @fileoverview Message Types and Interfaces
 * 
 * Defines all message type constants and interfaces for cross-context communication
 * between the popup, background service worker, content scripts, offscreen document,
 * and controller page.
 * 
 * Message flow: Popup → Background → (Offscreen|Controller) + Content
 */

import type { BaseEvent } from '../../core/types';

export type RecorderMode = 'screen' | 'tab' | 'window';

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
    PREPARE_RECORDING_VIDEO: 'PREPARE_RECORDING_VIDEO', // Background -> Offscreen (Warmup)
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
    GET_RECORDING_STATE: 'GET_RECORDING_STATE',
    GET_VIEWPORT_SIZE: 'GET_VIEWPORT_SIZE',

} as const;

export type MessageTypeName = typeof MSG_TYPES[keyof typeof MSG_TYPES];

// --- Storage Keys ---

export const STORAGE_KEYS = {
    RECORDING_STATE: 'recording_state'
} as const;

// --- State Interfaces ---

export interface RecordingState {
    isRecording: boolean;
    recordedTabId: number | null;
    controllerTabId: number | null;
    startTime: number;
    currentSessionId: string | null;
    mode: RecorderMode | null;
    originalTabId: number | null;
}

// --- Payloads ---

export interface RecordingConfig {
    hasAudio: boolean;
    hasCamera: boolean;
    audioDeviceId?: string; // Microphone
    videoDeviceId?: string; // Camera
    tabViewportSize?: import('../../core/types').Size; // Target dimensions (for window mode calibration)
    streamId?: string; // Required for tab recording
    sourceId?: string; // For desktop capture (window/desktop mode)
    sourceName?: string; // Human readable name (e.g. Tab Title)
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
