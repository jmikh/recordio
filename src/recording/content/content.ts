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
 * Events are sent to the background service worker via chrome.runtime.sendMessage,
 * which forwards them to the active recorder (offscreen or controller).
 */

import { logger } from '../../utils/logger';
import { initSentry } from '../../utils/sentry';
import { MSG_TYPES, type BaseMessage } from '../shared/messageTypes';
import { EventRecorder } from './eventRecorder';
import { BlurManager } from './blurManager';

// Initialize Sentry for error tracking
initSentry('content');

// Cleanup mechanism for previous instances
const cleanupEvent = new Event('recordo-cleanup');
window.dispatchEvent(cleanupEvent);

window.addEventListener('recordo-cleanup', () => {
    logger.log("[Recordo] Cleaning up old content script instance.");
    if (eventRecorder) {
        eventRecorder.stop();
        eventRecorder = null;
    }
    // Remove listeners
    chrome.runtime.onMessage.removeListener(handleMessage);
}, { once: true });

// --- Initialization ---
logger.log("[Recordo] Content script loaded. Checking recording state...");

chrome.runtime.sendMessage({
    type: MSG_TYPES.GET_RECORDING_STATE,
    payload: {}
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
let eventRecorder: EventRecorder | null = null;
let isPreparing = false;
let currentSessionId = '';
const blurManager = new BlurManager();

// --- Message Listener ---
const handleMessage = (message: any, _sender: chrome.runtime.MessageSender, _sendResponse: Function) => {
    // 1. Validation
    // 1. Validation
    // Message targeting validation removed


    switch (message.type) {
        case MSG_TYPES.GET_VIEWPORT_SIZE:
            // @ts-ignore
            _sendResponse({
                width: window.innerWidth,
                height: window.innerHeight,
                dpr: window.devicePixelRatio
            });
            break;

        case MSG_TYPES.START_COUNTDOWN:
            handleCountdown(message);
            break;

        case MSG_TYPES.START_RECORDING_EVENTS:
            console.log("[Content] Starting recording events...");
            handleStartRecording(message);
            break;

        case MSG_TYPES.STOP_RECORDING_EVENTS:
            console.log("[Content] Stopping recording events...");
            handleStopRecording();
            break;

        case MSG_TYPES.ENABLE_BLUR_MODE:
            blurManager.enable();
            break;

        case MSG_TYPES.DISABLE_BLUR_MODE:
            blurManager.disable();
            break;
    }
};

chrome.runtime.onMessage.addListener(handleMessage);

// --- Handlers ---

function handleCountdown(message: BaseMessage) {
    if (isPreparing) return;
    isPreparing = true;
    currentSessionId = message.payload?.sessionId;
    blurManager.disable(); // Ensure tool UI is gone before recording
    logger.log("[Content] Preparing recording (Countdown)", currentSessionId);
    startCountdown().then(() => {
        isPreparing = false;
        // Notify background we are ready with dimensions
        const readyMsg: BaseMessage = {
            type: MSG_TYPES.COUNTDOWN_DONE,
            payload: {
                sessionId: currentSessionId,
                width: window.innerWidth,
                height: window.innerHeight,
                dpr: window.devicePixelRatio
            }
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
    blurManager.disable(); // Ensure tool UI is gone before recording
    const startTime = message.payload?.startTime || Date.now();
    startRecording(startTime);
}

function startRecording(startTime: number) {
    logger.log("[Content] Starting Recorder...");
    if (eventRecorder) {
        eventRecorder.stop();
    }
    eventRecorder = new EventRecorder(startTime);
}

function handleStopRecording() {
    logger.log("[Content] Stopping Recording...");
    if (eventRecorder) {
        eventRecorder.stop();
        eventRecorder = null;
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
