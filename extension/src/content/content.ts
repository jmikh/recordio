/**
 * @fileoverview Content Script for User Event Capture
 * 
 * Injected into recorded tabs to capture user interactions:
 * - Mouse clicks, movements, and drags
 * - Keyboard events (non-password fields)
 * - Scroll events
 * - Typing sessions
 * - URL changes
 * 
 * Events are sent via chrome.runtime.sendMessage which broadcasts
 * to all extension contexts. The controller tab picks them up directly.
 *
 * Also hosts the blur picker (BlurManager): the popup enables it on the active
 * tab, and it is closed whenever recording starts or resumes.
 */


import { initSentry } from '../utils/sentry';
import { MSG_TYPES, type BaseMessage } from '../shared/messageTypes';
import { EventRecorder } from './eventRecorder';
import { showCountdown } from './countdownOverlay';
import { BlurManager } from './blurManager';

// Initialize Sentry for error tracking
initSentry('content');

// Cleanup mechanism for previous instances
const cleanupEvent = new Event('recordio-cleanup');
window.dispatchEvent(cleanupEvent);

window.addEventListener('recordio-cleanup', () => {
    if (eventRecorder) {
        eventRecorder.stop();
        eventRecorder = null;
    }
    if (hideCountdown) {
        hideCountdown();
        hideCountdown = null;
    }
    blurManager.disable();
    // Remove listeners
    chrome.runtime.onMessage.removeListener(handleMessage);
}, { once: true });

// --- Initialization ---

chrome.runtime.sendMessage({
    type: MSG_TYPES.CONTENT_GET_RECORDING_STATE,
    payload: {}
}, (response) => {
    if (chrome.runtime.lastError) {
        console.warn("[Content] Get State failed (Background not ready?)", chrome.runtime.lastError);
        return;
    }
    if (response) {
        handleStateResponse(response);
    }
});

// --- State ---
let eventRecorder: EventRecorder | null = null;
let hideCountdown: (() => void) | null = null;
const blurManager = new BlurManager();

// --- Message Listener ---
const handleMessage = (message: any, _sender: chrome.runtime.MessageSender, _sendResponse: Function) => {
    switch (message.type) {
        case MSG_TYPES.START_RECORDING_EVENTS:
            handleStartRecording(message);
            break;

        case MSG_TYPES.STOP_RECORDING_EVENTS:
            handleStopRecording();
            break;

        case MSG_TYPES.BACKGROUND_CONTENT_SHOW_COUNTDOWN:
            console.log('[Content] SHOW_COUNTDOWN received');
            blurManager.disable(); // picker UI must be gone before the tab is captured
            hideCountdown = showCountdown(
                () => {
                    console.log('[Content] Countdown complete');
                    hideCountdown = null;
                    chrome.runtime.sendMessage({ type: MSG_TYPES.CONTENT_COUNTDOWN_COMPLETE }).catch(() => {});
                },
                () => {
                    console.log('[Content] Countdown cancelled');
                    hideCountdown = null;
                    chrome.runtime.sendMessage({ type: MSG_TYPES.CONTENT_COUNTDOWN_CANCELLED }).catch(() => {});
                },
            );
            break;

        case MSG_TYPES.BACKGROUND_CONTENT_HIDE_COUNTDOWN:
            if (hideCountdown) {
                hideCountdown();
                hideCountdown = null;
            }
            break;

        case MSG_TYPES.POPUP_ENABLE_BLUR_MODE:
            blurManager.enable();
            break;

        case MSG_TYPES.POPUP_DISABLE_BLUR_MODE:
        case MSG_TYPES.BACKGROUND_CONTENT_DISABLE_BLUR_MODE:
            blurManager.disable();
            break;
    }
};

chrome.runtime.onMessage.addListener(handleMessage);

// --- Handlers ---

function handleStateResponse(response: any) {
    if (response.isRecording) {
        startRecording(response.startTime || 0);
    }
}

function handleStartRecording(message: any) {
    blurManager.disable(); // Ensure picker UI is gone before frames are captured
    const startTime = message.payload?.startTime || Date.now();
    startRecording(startTime);
}

function startRecording(startTime: number) {
    if (eventRecorder) {
        eventRecorder.stop();
    }
    eventRecorder = new EventRecorder(startTime);
}

function handleStopRecording() {
    if (eventRecorder) {
        eventRecorder.stop();
        eventRecorder = null;
    }
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
