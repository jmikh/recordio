/**
 * @fileoverview Offscreen Document for Tab Mode Recording
 * 
 * Chrome extension service workers cannot access MediaRecorder API directly.
 * This offscreen document provides a DOM context where MediaRecorder can run.
 * Used exclusively for TAB recording mode.
 * 
 * For window/desktop recording, see controller.ts instead.
 */

import { VideoRecorder } from './shared/videoRecorder';
import { MSG_TYPES, type BaseMessage, type RecordingConfig } from './shared/messageTypes';


let recorder: VideoRecorder | null = null;
const mode = 'tab';

// Message Listener
chrome.runtime.onMessage.addListener((message: any, _sender, sendResponse) => {
    const msg = message as BaseMessage;

    switch (msg.type) {
        case MSG_TYPES.PREPARE_RECORDING_VIDEO:
            handlePrepare(msg)
                .then((response) => sendResponse(response));
            return true;

        case MSG_TYPES.START_RECORDING_VIDEO:
            handleStart(msg)
                .then((response) => sendResponse(response));
            return true;

        case MSG_TYPES.STOP_RECORDING_VIDEO:
            handleStop(msg)
                .then((response) => sendResponse(response));
            return true;

        case MSG_TYPES.CAPTURE_USER_EVENT:
            if (msg.payload && recorder) {
                recorder.addEvent(msg.payload);
            }
            return false;

        case MSG_TYPES.PING_OFFSCREEN:
            sendResponse("PONG");
            return false;
    }

    return false;
});

async function handleStart(message: BaseMessage) {
    // const config: RecordingConfig = message.payload.config; // Config is now used in prepare()
    const sessionId = message.payload.sessionId;

    // Strict check: Recorder MUST be prepared by now
    if (!recorder || recorder.getStatus().sessionId !== sessionId) {
        throw new Error("Recorder not prepared for this session. You must call PREPARE_RECORDING_VIDEO first.");
    }

    await recorder.start();

    return { success: true, startTime: Date.now() };
}

async function handlePrepare(message: BaseMessage) {
    const config: RecordingConfig = message.payload.config;
    const sessionId = message.payload.sessionId;

    // Use current recorder if exists and matches session (though usually it's null)
    if (!recorder) {
        recorder = new VideoRecorder(sessionId, config, mode);
    }

    await recorder.prepare(config);

    return { success: true };
}

async function handleStop(message: BaseMessage) {
    const sessionId = message.payload?.sessionId;

    if (recorder) {
        await recorder.finish(sessionId);
    } else {
        throw new Error("Could not find a video recorder to stop");
    }

    recorder = null;

    return { success: true };
}
