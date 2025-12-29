import { VideoRecorder } from '../shared/videoRecorder';
import type { BaseMessage } from '../shared/messageTypes';
import { MSG_TYPES } from '../shared/messageTypes';

console.log("[Controller] Initializing...");

let recorder: VideoRecorder | null = null;
const statusEl = document.getElementById('status');
const logsEl = document.getElementById('logs');

function updateStatus(text: string) {
    if (statusEl) statusEl.innerText = `Status: ${text}`;
}

function log(text: string) {
    if (logsEl) {
        const div = document.createElement('div');
        div.innerText = `${new Date().toLocaleTimeString()} - ${text}`;
        logsEl.prepend(div);
    }
    console.log(`[Controller] ${text}`);
}

// Listen for messages directed to the controller
chrome.runtime.onMessage.addListener((message: BaseMessage, _sender, sendResponse) => {
    // Basic filter for now
    // Basic filter for now
    // Removed target check


    log(`Received message: ${message.type}`);

    // Delegate to recorder
    const handleMessage = async () => {
        try {
            if (message.type === MSG_TYPES.START_RECORDING_VIDEO) {
                const { config, mode = 'window', sessionId } = message.payload || {};


                try {
                    recorder = new VideoRecorder(sessionId, config, mode);
                    await recorder.start();
                    sendResponse({
                        success: true,
                        startTime: Date.now()
                    });
                } catch (err) {
                    console.warn("error starting recording:", err);
                    sendResponse({ success: false, error: String(err) });
                }

            } else if (message.type === MSG_TYPES.STOP_RECORDING_VIDEO) {
                const { sessionId } = message.payload || {};


                if (recorder) {
                    const res = await recorder.finish(sessionId);
                    sendResponse({
                        success: true,
                        durationMs: res.durationMs
                    });
                    // Cleanup ref
                    recorder = null;
                } else {
                    sendResponse({ success: false, error: "No active recorder" });
                }

            }

            // UI Updates based on state
            if (recorder) {
                const status = recorder.getStatus();
                updateStatus(`${status.state.toUpperCase()} (Session: ${status.sessionId || 'None'})`);
            } else {
                updateStatus('IDLE');
            }

        } catch (err: any) {
            log(`Error handling message: ${err.message}`);
            sendResponse({ success: false, error: err.message });
        }
    };

    handleMessage();
    return true; // Async
});

// Notify Background that we are ready
chrome.runtime.sendMessage({
    type: 'CONTROLLER_READY', // We might need to add this to MSG_TYPES or use generic LOG
    payload: { sessionId: 'init' }
});

log("Controller Ready");
