import { VideoRecorder } from '../shared/videoRecorder';
import { MSG_TYPES, type BaseMessage, type RecordingConfig } from '../shared/messageTypes';


const recorder = new VideoRecorder();
const mode = 'tab';

function sendMessageToBackground(type: string, sessionId: string, payload?: any) {
    chrome.runtime.sendMessage({
        type,
        source: 'offscreen',
        target: 'background',
        sessionId,
        timestamp: Date.now(),
        payload
    });
}


// Message Listener
chrome.runtime.onMessage.addListener((message: any, _sender, sendResponse) => {
    const msg = message as BaseMessage;

    // Strict Filter: Only handle messages intended for offscreen
    if (msg.target !== 'offscreen') return false;

    // Orchestration
    switch (msg.type) {
        case MSG_TYPES.START_RECORDING:
            handleStart(msg).then(() => {
                // Success handled inside handleStart
            }).catch(err => {
                sendMessageToBackground(MSG_TYPES.ERROR_OCCURRED, msg.sessionId, { error: err.message, context: 'start' });
            });
            return false;

        case MSG_TYPES.STOP_RECORDING:
            handleStop(msg).then(() => {
                // Success handled inside handleStop
            }).catch(err => {
                console.error("Failed to stop recording:", err);
            });
            return false;

        case MSG_TYPES.CANCEL_RECORDING:
            if (msg.sessionId) {
                recorder.cancel(msg.sessionId).then(() => {
                    sendMessageToBackground(MSG_TYPES.RECORDING_CANCELLED, msg.sessionId);
                });
            }
            return false;

        case MSG_TYPES.CAPTURE_USER_EVENT:
            if (msg.payload) {
                recorder.addEvent(msg.payload);
            }
            return false; // No response needed

        case MSG_TYPES.PING_OFFSCREEN:
            sendResponse("PONG");
            return false;
    }

    return false;
});

async function handleStart(message: BaseMessage) {
    if (!message.payload) return;

    const config: RecordingConfig = message.payload.config;
    const sessionId = message.sessionId;

    try {
        await recorder.start(sessionId, config, mode);

        // Notify Background
        sendMessageToBackground(MSG_TYPES.RECORDING_STARTED, sessionId, { startTime: Date.now() });

    } catch (err: any) {
        console.error("Failed to start recording:", err);
    }
}

async function handleStop(message: BaseMessage) {
    const sessionId = message.sessionId;
    // events are now buffered internally

    try {
        const result = await recorder.finish(sessionId);

        sendMessageToBackground(MSG_TYPES.RECORDING_STOPPED, sessionId, { durationMs: result?.durationMs || 0 });
    } catch (err: any) {
        console.error("Error stopping recording:", err);
        // Should we notify background of error? probably.
        sendMessageToBackground(MSG_TYPES.ERROR_OCCURRED, sessionId, { error: err.message, context: 'stop' });
    }
}
