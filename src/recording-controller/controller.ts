import { VideoRecorder } from '../shared/videoRecorder';
import { MSG_TYPES, type BaseMessage, type RecordingConfig } from '../shared/messageTypes';



let recorder: VideoRecorder | null = null;

// Message Listener
chrome.runtime.onMessage.addListener((message: any, _sender, sendResponse) => {
    const msg = message as BaseMessage;

    switch (msg.type) {
        case MSG_TYPES.START_RECORDING_VIDEO:
            if (message.payload?.mode === 'tab') {
                return false;
            }
            handleStart(msg)
                .then((response) => sendResponse(response))
                .catch((e) => sendResponse({ success: false, error: e.message }));
            return true;

        case MSG_TYPES.STOP_RECORDING_VIDEO:
            if (message.payload?.mode === 'tab') {
                return false;
            }
            handleStop(msg)
                .then((response) => sendResponse(response))
                .catch((e) => sendResponse({ success: false, error: e.message }));
            return true;

        case MSG_TYPES.CAPTURE_USER_EVENT:
            if (msg.payload && recorder) {
                recorder.addEvent(msg.payload);
            }
            return false;

        case MSG_TYPES.PING_CONTROLLER:
            sendResponse("PONG");
            return false;
    }

    return false;
});

async function handleStart(message: BaseMessage) {
    const config: RecordingConfig = message.payload.config;
    const sessionId = message.payload.sessionId;
    const msgMode = message.payload.mode || 'window';

    // Determine viewport size from this window
    const dpr = window.devicePixelRatio || 1;
    const viewportSize = {
        width: Math.round(window.innerWidth * dpr),
        height: Math.round(window.innerHeight * dpr)
    };

    // Merge viewport into config
    const fullConfig: RecordingConfig = {
        ...config,
        tabViewportSize: viewportSize
    };

    recorder = new VideoRecorder(sessionId, fullConfig, msgMode);

    await recorder.start();

    return { success: true, startTime: Date.now() };
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
