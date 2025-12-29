import { logger } from '../utils/logger';
import { MSG_TYPES, type BaseMessage } from '../shared/messageTypes';
import { ContentRecorder } from './contentRecorder';

// Cleanup mechanism for previous instances
const cleanupEvent = new Event('recordo-cleanup');
window.dispatchEvent(cleanupEvent);

window.addEventListener('recordo-cleanup', () => {
    logger.log("[Recordo] Cleaning up old content script instance.");
    if (contentRecorder) {
        contentRecorder.stop();
        contentRecorder = null;
    }
    // Remove listeners
    chrome.runtime.onMessage.removeListener(handleMessage);
}, { once: true });

// --- Initialization ---
logger.log("[Recordo] Content script loaded. Checking recording state...");

chrome.runtime.sendMessage({
    type: MSG_TYPES.GET_RECORDING_STATE,
    source: 'content',
    target: 'background',
    sessionId: '',
    timestamp: Date.now()
}, (response) => {
    if (chrome.runtime.lastError) {
        logger.warn("[Content] Get State failed (Background not ready?)", chrome.runtime.lastError);
        return;
    }
    if (response) {
        handleStateResponse(response);
    }
});

// --- State ---
let contentRecorder: ContentRecorder | null = null;
let isPreparing = false;
let currentSessionId = '';

// --- Message Listener ---
const handleMessage = (message: any, _sender: chrome.runtime.MessageSender, _sendResponse: Function) => {
    // 1. Validation
    if (message.target !== 'content') return;

    switch (message.type) {
        case MSG_TYPES.PREPARE_RECORDING:
            handlePrepareRecording(message);
            break;

        case MSG_TYPES.START_RECORDING:
            handleStartRecording(message);
            break;

        case MSG_TYPES.STOP_RECORDING:
            handleStopRecording();
            break;
    }
};

chrome.runtime.onMessage.addListener(handleMessage);

// --- Handlers ---

function handlePrepareRecording(message: BaseMessage) {
    if (isPreparing) return;
    isPreparing = true;
    currentSessionId = message.sessionId;
    logger.log("[Content] Preparing recording (Countdown)", currentSessionId);
    startCountdown().then(() => {
        isPreparing = false;
        // Notify background we are ready
        const readyMsg: BaseMessage = {
            type: MSG_TYPES.RECORDING_READY,
            source: 'content',
            target: 'background',
            sessionId: currentSessionId,
            timestamp: Date.now()
        };
        chrome.runtime.sendMessage(readyMsg);
    });
}

function handleStateResponse(response: any) {
    logger.log(`[Content] Init State: Recording=${response.isRecording}`);

    if (response.isRecording) {
        logger.log("[Content] Auto-resuming recording...");
        startRecording(response.startTime || 0);
    }
}

function handleStartRecording(message: any) {
    const startTime = message.payload?.startTime || Date.now();
    startRecording(startTime);
}

function startRecording(startTime: number) {
    logger.log("[Content] Starting Recorder...");
    if (contentRecorder) {
        contentRecorder.stop();
    }
    contentRecorder = new ContentRecorder(startTime);
}

function handleStopRecording() {
    logger.log("[Content] Stopping Recording...");
    if (contentRecorder) {
        contentRecorder.stop();
        contentRecorder = null;
    }
}

// --- Utils ---

function startCountdown(): Promise<void> {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        Object.assign(overlay.style, {
            position: 'fixed', top: '0', left: '0', width: '100vw', height: '100vh',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            backgroundColor: 'rgba(0, 0, 0, 0.3)', zIndex: '2147483647',
            color: 'white', fontSize: '120px', fontWeight: 'bold', fontFamily: 'sans-serif',
            pointerEvents: 'none'
        });
        document.body.appendChild(overlay);

        let count = 3;
        overlay.innerText = count.toString();

        const interval = setInterval(() => {
            count--;
            if (count > 0) {
                overlay.innerText = count.toString();
            } else {
                clearInterval(interval);
                overlay.remove();
                resolve();
            }
        }, 1000);
    });
}

// History API Patching (for URL changes)
const originalPushState = history.pushState;
history.pushState = function (...args) {
    originalPushState.apply(this, args);
    window.dispatchEvent(new Event('popstate')); // Simulate popstate for consistency
};
const originalReplaceState = history.replaceState;
history.replaceState = function (...args) {
    originalReplaceState.apply(this, args);
    window.dispatchEvent(new Event('popstate'));
};