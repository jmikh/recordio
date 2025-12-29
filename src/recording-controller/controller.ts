import { VideoRecorder } from '../shared/videoRecorder';
import type { BaseMessage } from '../shared/messageTypes';
import { MSG_TYPES } from '../shared/messageTypes';

console.log("[Controller] Initializing...");

const recorder = new VideoRecorder();
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
chrome.runtime.onMessage.addListener((message: BaseMessage) => {
    // Basic filter for now
    if (message.target !== 'controller') return;

    log(`Received message: ${message.type}`);

    // Delegate to recorder
    try {
        if (message.type === MSG_TYPES.START_RECORDING) {
            const { sessionId, payload } = message;
            const config = payload.config;
            // Mode: 'window' for desktop/controller usually, but payload tells truth
            const mode = payload.mode || 'window';

            recorder.start(sessionId, config, mode).then(() => {
                chrome.runtime.sendMessage({
                    type: MSG_TYPES.RECORDING_STARTED,
                    source: 'controller',
                    target: 'background',
                    sessionId,
                    timestamp: Date.now(),
                    payload: { startTime: Date.now() }
                });
            }).catch(err => {
                chrome.runtime.sendMessage({
                    type: MSG_TYPES.ERROR_OCCURRED,
                    source: 'controller',
                    target: 'background',
                    sessionId,
                    timestamp: Date.now(),
                    payload: { error: err.message, context: 'start' }
                });
            });

        } else if (message.type === MSG_TYPES.STOP_RECORDING) {
            const { sessionId } = message;
            // const events = payload?.events || null; // Events are handled internally now

            recorder.finish(sessionId).then((res) => {
                chrome.runtime.sendMessage({
                    type: MSG_TYPES.RECORDING_STOPPED,
                    source: 'controller',
                    target: 'background',
                    sessionId,
                    timestamp: Date.now(),
                    payload: { durationMs: res.durationMs }
                });
            });

        } else if (message.type === MSG_TYPES.CANCEL_RECORDING) {
            const { sessionId } = message;
            if (sessionId) recorder.cancel(sessionId);
            chrome.runtime.sendMessage({
                type: MSG_TYPES.RECORDING_CANCELLED,
                source: 'controller',
                target: 'background',
                sessionId,
                timestamp: Date.now()
            });
        }

        // UI Updates based on state
        const status = recorder.getStatus();
        updateStatus(`${status.state.toUpperCase()} (Session: ${status.sessionId || 'None'})`);

    } catch (err: any) {
        log(`Error handling message: ${err.message}`);
        // Notify background of error
        chrome.runtime.sendMessage({
            type: MSG_TYPES.ERROR_OCCURRED,
            source: 'controller',
            target: 'background',
            payload: { error: err.message }
        });
    }

    // Check if we need to send a response (if message expects one)
    // For now, async response logic is minimal
    return false;
});

// Notify Background that we are ready
chrome.runtime.sendMessage({
    type: 'CONTROLLER_READY', // We might need to add this to MSG_TYPES or use generic LOG
    source: 'controller',
    target: 'background',
    timestamp: Date.now(),
    sessionId: 'init'
});

log("Controller Ready");
