import type { Size, UserEvents } from '../core/types';

/**
 * Global message registry for extension communication.
 * Defines all message types passed between Background, Content Script, Offscreen, and Popup.
 */
export const MSG = {
    // --- Popup / App -> Background ---
    START_RECORDING: 'START_RECORDING',
    STOP_RECORDING: 'STOP_RECORDING',
    GET_RECORDING_STATE: 'GET_RECORDING_STATE',

    // --- Background <-> Offscreen Document ---
    PING_OFFSCREEN: 'PING_OFFSCREEN',           // Check if offscreen is alive
    OFFSCREEN_READY: 'OFFSCREEN_READY',         // Offscreen tells Background it's loaded
    PREPARE_RECORDING: 'PREPARE_RECORDING',     // Background -> Offscreen: Init streams
    RECORDING_PREPARED: 'RECORDING_PREPARED',   // Offscreen -> Background: Streams ready
    RECORDING_STARTED: 'RECORDING_STARTED',     // Background -> Offscreen: Start MediaRecorder
    STOP_RECORDING_OFFSCREEN: 'STOP_RECORDING_OFFSCREEN', // Background -> Offscreen: Stop & Save
    OPEN_EDITOR: 'OPEN_EDITOR',                 // Offscreen -> Background: Open editor tab

    // --- Background <-> Content Script ---
    SHOW_COUNTDOWN: 'SHOW_COUNTDOWN',           // Background -> Content: Show 3..2..1 overlay
    COUNTDOWN_FINISHED: 'COUNTDOWN_FINISHED',   // Content -> Background: Countdown done
    RECORDING_STATUS_CHANGED: 'RECORDING_STATUS_CHANGED', // Background -> Content: Update state

} as const;

export type MessageName = typeof MSG[keyof typeof MSG];

export interface RecordingStateResponse {
    isRecording: boolean;
    startTime?: number;
    success?: boolean;
    error?: string;
}

// Map message -> request/response types
export type MessageMap = {
    // --- User Actions (Popup -> Background) ---
    [MSG.START_RECORDING]: {
        req: {
            tabId?: number; // Optional in window mode (implied active)
            recordingMode: 'tab' | 'window';
            hasAudio: boolean;
            hasCamera: boolean;
            audioDeviceId?: string;
            videoDeviceId?: string;
        };
        res: RecordingStateResponse;
    };
    [MSG.STOP_RECORDING]: {
        req: {};
        res: RecordingStateResponse;
    };
    [MSG.GET_RECORDING_STATE]: {
        req: {};
        res: RecordingStateResponse;
    };

    // --- Offscreen Coordination ---
    [MSG.PING_OFFSCREEN]: {
        req: {};
        res: "PONG";
    };
    [MSG.OFFSCREEN_READY]: {
        req: {};
        res: void;
    };
    [MSG.PREPARE_RECORDING]: {
        req: {
            streamId: string;
            data: {
                hasAudio: boolean;
                hasCamera: boolean;
                audioDeviceId?: string;
                videoDeviceId?: string;
                dimensions?: Size;
            }
        };
        res: void;
    };
    [MSG.RECORDING_PREPARED]: {
        req: {};
        res: void;
    };
    [MSG.RECORDING_STARTED]: {
        req: { startTime: number };
        res: void;
    };
    [MSG.STOP_RECORDING_OFFSCREEN]: {
        req: { events: UserEvents };
        res: void;
    };
    [MSG.OPEN_EDITOR]: {
        req: { url: string };
        res: void;
    };

    // --- Content Script Coordination ---
    [MSG.SHOW_COUNTDOWN]: {
        req: {};
        res: void;
    };
    [MSG.COUNTDOWN_FINISHED]: {
        req: { timestamp: number };
        res: void;
    };
    [MSG.RECORDING_STATUS_CHANGED]: {
        req: { isRecording: boolean; startTime: number };
        res: void;
    };
};
