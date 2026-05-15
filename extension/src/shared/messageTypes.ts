/**
 * @fileoverview Message Types and Interfaces
 *
 * Defines all message type constants and interfaces for cross-context communication
 * between the background service worker, content scripts, controller page,
 * popup, and offscreen document.
 *
 * Naming conventions:
 *   POPUP_*              Popup → Background
 *   BACKGROUND_*         Background → any other context
 *   CONTROLLER_*         Controller → Background
 *   OFFSCREEN_*          Offscreen → Background
 *   CONTENT_*            Content script → any other context
 *
 * Message flow overview:
 *
 *   POPUP → BACKGROUND (chrome.runtime.sendMessage)
 *     POPUP_START_TAB_RECORDING   Start tab recording via offscreen doc
 *     POPUP_OPEN_SOURCE_PICKER    Open controller tab; recording starts automatically after source picked
 *     POPUP_PAUSE_RECORDING       Pause active recording (routed to offscreen or controller)
 *     POPUP_RESUME_RECORDING      Resume paused recording
 *     POPUP_CANCEL_RECORDING      Cancel and discard recording
 *     POPUP_FINISH_RECORDING      Finish and save recording
 *
 *   BACKGROUND → OFFSCREEN (chrome.runtime.sendMessage)
 *     BACKGROUND_OFFSCREEN_INIT     Initialize offscreen doc with stream + settings
 *     BACKGROUND_OFFSCREEN_PREPARE  Pre-warm camera/mic during countdown
 *     BACKGROUND_OFFSCREEN_PAUSE    Pause the offscreen recorder
 *     BACKGROUND_OFFSCREEN_RESUME   Resume the offscreen recorder
 *     BACKGROUND_OFFSCREEN_CANCEL   Cancel and discard the offscreen recording
 *     BACKGROUND_OFFSCREEN_FINISH   Finalize and save the offscreen recording
 *
 *   OFFSCREEN → BACKGROUND (chrome.runtime.sendMessage)
 *     OFFSCREEN_DONE              Recording complete or cancelled, carries result
 *
 *   BACKGROUND → CONTROLLER TAB (chrome.tabs.sendMessage)
 *     STOP_SESSION                           Stop/finish controller recording
 *     BACKGROUND_CONTROLLER_PAUSE            Pause the controller recording
 *     BACKGROUND_CONTROLLER_RESUME           Resume the controller recording
 *     BACKGROUND_CONTROLLER_CANCEL           Cancel and discard the controller recording
 *     BACKGROUND_CONTROLLER_START_RECORDING  Start recording now (sent after popup countdown)
 *
 *   CONTROLLER → BACKGROUND (chrome.runtime.sendMessage)
 *     CONTROLLER_SOURCE_SELECTED    Source picked, stream ready; background switches back to original tab
 *     CONTROLLER_STARTED_RECORDING  Recording has started (confirmation)
 *     CONTROLLER_STOPPED_RECORDING
 *     RECORDING_FAILED              Save failed — background stores error + cleans up
 *
 *   OFFSCREEN → BACKGROUND (chrome.runtime.sendMessage)
 *     RECORDING_FAILED              Save failed — background stores error + cleans up
 *
 *   BACKGROUND → CONTENT (chrome.tabs.sendMessage broadcast)
 *     BACKGROUND_CONTENT_SHOW_COUNTDOWN
 *     BACKGROUND_CONTENT_HIDE_COUNTDOWN
 *     START_RECORDING_EVENTS
 *     STOP_RECORDING_EVENTS
 *
 *   CONTENT → BACKGROUND / CONTROLLER / OFFSCREEN (chrome.runtime.sendMessage)
 *     CONTENT_GET_RECORDING_STATE
 *     CONTENT_CAPTURE_USER_EVENT
 *     CONTENT_COUNTDOWN_COMPLETE
 *     CONTENT_COUNTDOWN_CANCELLED
 *     CONTENT_PLAY_COUNTDOWN_SOUND
 */

import type { BaseEvent, Size } from '@shared/types';


export interface BaseMessage {
    type: string;
    payload?: any;
}

// --- Message Types ---

export const MSG_TYPES = {
    // ── Existing: Session Control ──────────────────────────────────────────
    /** Background → Controller tab: stop/finish the active controller recording */
    STOP_SESSION: 'STOP_SESSION',

    // ── Background → Content (broadcast) ────────────────────────────────────
    /** Background → Content (broadcast): start capturing user events */
    START_RECORDING_EVENTS: 'START_RECORDING_EVENTS',
    /** Background → Content (broadcast): stop capturing user events */
    STOP_RECORDING_EVENTS: 'STOP_RECORDING_EVENTS',

    // ── Content → any context ────────────────────────────────────────────────
    /** Content → Controller/Offscreen: a captured user interaction event */
    CONTENT_CAPTURE_USER_EVENT: 'CONTENT_CAPTURE_USER_EVENT',
    /** Content → Background: request current recording state on script init */
    CONTENT_GET_RECORDING_STATE: 'CONTENT_GET_RECORDING_STATE',
    /** Content → Background: countdown finished, proceed with recording */
    CONTENT_COUNTDOWN_COMPLETE: 'CONTENT_COUNTDOWN_COMPLETE',
    /** Content → Background: user clicked Cancel on countdown overlay */
    CONTENT_COUNTDOWN_CANCELLED: 'CONTENT_COUNTDOWN_CANCELLED',
    /** Content → Offscreen: play the countdown sound (avoids content-script autoplay restrictions) */
    CONTENT_PLAY_COUNTDOWN_SOUND: 'CONTENT_PLAY_COUNTDOWN_SOUND',

    // ── Controller → Background ──────────────────────────────────────────────
    /** Controller → Background: recording has started (payload: session info) */
    CONTROLLER_STARTED_RECORDING: 'CONTROLLER_STARTED_RECORDING',
    /** Controller → Background: recording saved, ready for import */
    CONTROLLER_STOPPED_RECORDING: 'CONTROLLER_STOPPED_RECORDING',
    /** Controller or Offscreen → Background: save failed
     *  payload: { error: string, mode: 'tab' | 'controller' } */
    RECORDING_FAILED: 'RECORDING_FAILED',

    // ── New: Popup → Background ─────────────────────────────────────────────
    /** Popup → Background: start tab recording via offscreen doc
     *  payload: { hasAudio, audioDeviceId?, hasVideo, videoDeviceId? } */
    POPUP_START_TAB_RECORDING: 'POPUP_START_TAB_RECORDING',
    /** Popup → Background: open controller tab for source selection; recording starts automatically after
     *  payload: { hasAudio, audioDeviceId?, hasCamera, videoDeviceId? } */
    POPUP_OPEN_SOURCE_PICKER: 'POPUP_OPEN_SOURCE_PICKER',
    /** Popup → Background: pause the active recording (offscreen or controller) */
    POPUP_PAUSE_RECORDING: 'POPUP_PAUSE_RECORDING',
    /** Popup → Background: resume the paused recording */
    POPUP_RESUME_RECORDING: 'POPUP_RESUME_RECORDING',
    /** Popup → Background: cancel and discard the active recording */
    POPUP_CANCEL_RECORDING: 'POPUP_CANCEL_RECORDING',
    /** Popup → Background: finalize and save the active recording */
    POPUP_FINISH_RECORDING: 'POPUP_FINISH_RECORDING',

    // ── New: Background → Offscreen ─────────────────────────────────────────
    /** Background → Offscreen: initialize recording with tab stream + settings
     *  payload: { tabStreamId, hasAudio, audioDeviceId?, hasVideo, videoDeviceId?, sessionId } */
    BACKGROUND_OFFSCREEN_INIT: 'BACKGROUND_OFFSCREEN_INIT',
    /** Background → Offscreen: pause the recorder */
    BACKGROUND_OFFSCREEN_PAUSE: 'BACKGROUND_OFFSCREEN_PAUSE',
    /** Background → Offscreen: resume the recorder */
    BACKGROUND_OFFSCREEN_RESUME: 'BACKGROUND_OFFSCREEN_RESUME',
    /** Background → Offscreen: cancel and discard */
    BACKGROUND_OFFSCREEN_CANCEL: 'BACKGROUND_OFFSCREEN_CANCEL',
    /** Background → Offscreen: finalize and save */
    BACKGROUND_OFFSCREEN_FINISH: 'BACKGROUND_OFFSCREEN_FINISH',
    /** Background → Offscreen: pre-open camera/mic streams during countdown so they're warm by recording start */
    BACKGROUND_OFFSCREEN_PREPARE: 'BACKGROUND_OFFSCREEN_PREPARE',
    /** Background → Offscreen: grab a preview JPEG frame from the current recording stream
     *  response: { dataUrl: string } | null */
    BACKGROUND_OFFSCREEN_GET_PREVIEW: 'BACKGROUND_OFFSCREEN_GET_PREVIEW',

    // ── New: Offscreen → Background ─────────────────────────────────────────
    /** Offscreen → Background: recording done (or cancelled)
     *  payload: { cancelled: boolean, sessionId?: string } */
    OFFSCREEN_DONE: 'OFFSCREEN_DONE',

    // ── New: Background → Controller Tab ────────────────────────────────────
    /** Background → Controller tab: pause the controller recording */
    BACKGROUND_CONTROLLER_PAUSE: 'BACKGROUND_CONTROLLER_PAUSE',
    /** Background → Controller tab: resume the controller recording */
    BACKGROUND_CONTROLLER_RESUME: 'BACKGROUND_CONTROLLER_RESUME',
    /** Background → Controller tab: cancel and discard the controller recording */
    BACKGROUND_CONTROLLER_CANCEL: 'BACKGROUND_CONTROLLER_CANCEL',
    /** Background → Controller tab: start recording now with provided config
     *  payload: { hasAudio, audioDeviceId?, hasCamera, videoDeviceId?, sessionId } */
    BACKGROUND_CONTROLLER_START_RECORDING: 'BACKGROUND_CONTROLLER_START_RECORDING',

    // ── Controller → Background ──────────────────────────────────────────────
    /** Controller → Background: source selected, stream ready; background switches to original tab
     *  payload: { captureType: 'another_window' | 'desktop', sourceName: string } */
    CONTROLLER_SOURCE_SELECTED: 'CONTROLLER_SOURCE_SELECTED',
    /** Controller → Background: tab loaded and ready; background responds with pending mic/camera config
     *  so the controller can prewarm streams while the OS picker is open.
     *  response: { hasAudio, audioDeviceId?, hasCamera, videoDeviceId? } | null */
    CONTROLLER_READY: 'CONTROLLER_READY',
    /** Popup → Controller tab: request a JPEG preview frame of the display stream
     *  response: { dataUrl: string } | null */
    POPUP_REQUEST_PREVIEW_FRAME: 'POPUP_REQUEST_PREVIEW_FRAME',

    // ── Background → Content (countdown) ────────────────────────────────────
    /** Background → Content: show countdown overlay before tab recording starts */
    BACKGROUND_CONTENT_SHOW_COUNTDOWN: 'BACKGROUND_CONTENT_SHOW_COUNTDOWN',
    /** Background → Content: hide countdown overlay (e.g. abort before it finishes) */
    BACKGROUND_CONTENT_HIDE_COUNTDOWN: 'BACKGROUND_CONTENT_HIDE_COUNTDOWN',
} as const;

export type MessageTypeName = typeof MSG_TYPES[keyof typeof MSG_TYPES];

// --- Storage Keys ---

export const STORAGE_KEYS = {
    RECORDING_STATE: 'recording_state',
    /** Stores { message: string } when a recording save fails, cleared after popup reads it */
    RECORDING_ERROR: 'recording_error',
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
    /** Whether the recording is currently paused */
    isPaused: boolean;
    /** Total milliseconds spent paused (for elapsed time calculation) */
    totalPausedMs: number;
    /** Timestamp when the current pause started (0 if not paused) */
    pauseStartTime: number;
    /** Whether this recording is running via offscreen doc ('tab') or the controller tab ('controller') */
    recordingMode: 'tab' | 'controller' | null;
    /** The capture source type, derived at start time */
    captureType: 'tab' | 'current_window' | 'another_window' | 'desktop' | null;
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
    /** True when the stream comes from tabCapture (getUserMedia), not getDisplayMedia/desktopCapture.
     *  tabCapture tracks don't populate displaySurface, so we use this flag instead. */
    isTabCapture?: boolean;
    /** Pre-warmed camera stream opened during countdown (offscreen mode only). Skips a fresh getUserMedia call. */
    warmCameraStream?: MediaStream;
    /** Pre-warmed mic stream opened during countdown (offscreen mode only). Skips a fresh getUserMedia call. */
    warmMicStream?: MediaStream;
}

export interface UserEventPayload extends BaseEvent {
    // Union of all user events (Mouse, Keyboard, etc.)
    // We import BaseEvent but really we pass the whole object.
    [key: string]: any;
}
