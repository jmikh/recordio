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


import { initSentry } from '../utils/sentry';
import { MSG_TYPES, type BaseMessage } from '../shared/messageTypes';
import { EventRecorder } from './eventRecorder';
import { BlurManager } from './blurManager';

// Initialize Sentry for error tracking
initSentry('content');

// Cleanup mechanism for previous instances
const cleanupEvent = new Event('recordio-cleanup');
window.dispatchEvent(cleanupEvent);

window.addEventListener('recordio-cleanup', () => {
    console.log("[Recordio] Cleaning up old content script instance.");
    if (eventRecorder) {
        eventRecorder.stop();
        eventRecorder = null;
    }
    // Remove listeners
    chrome.runtime.onMessage.removeListener(handleMessage);
}, { once: true });

// --- Initialization ---
console.log("[Recordio] Content script loaded. Checking recording state...");

chrome.runtime.sendMessage({
    type: MSG_TYPES.GET_RECORDING_STATE,
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
let isPreparing = false;
let currentSessionId = '';
const blurManager = new BlurManager();
let cursorHideStyle: HTMLStyleElement | null = null;

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

        case MSG_TYPES.SHOW_TAB_SWITCH_TOAST:
            showTabSwitchToast();
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
    console.log("[Content] Preparing recording (Countdown)", currentSessionId);
    startCountdown().then((result) => {
        isPreparing = false;

        if (result.canceled) {
            // User canceled — notify background, show toast
            const cancelMsg: BaseMessage = {
                type: MSG_TYPES.COUNTDOWN_CANCELED,
                payload: { sessionId: currentSessionId }
            };
            chrome.runtime.sendMessage(cancelMsg);
            showCancelToast();
            return;
        }

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
    console.log(`[Content] Init State: Recording=${response.isRecording}`);

    if (response.isRecording) {
        console.log("[Content] Auto-resuming recording...");
        startRecording(response.startTime || 0);
    }
}

function handleStartRecording(message: any) {
    blurManager.disable(); // Ensure tool UI is gone before recording
    const startTime = message.payload?.startTime || Date.now();
    startRecording(startTime);
}

function startRecording(startTime: number) {
    console.log("[Content] Starting Recorder...");
    if (eventRecorder) {
        eventRecorder.stop();
    }
    eventRecorder = new EventRecorder(startTime);

    // Hide native cursor during recording (CSS-based, since Chrome
    // doesn't support the cursor MediaTrackConstraint)
    if (!cursorHideStyle) {
        cursorHideStyle = document.createElement('style');
        cursorHideStyle.id = 'recordio-cursor-hide';
        cursorHideStyle.textContent = '*, *::before, *::after { cursor: none !important; }';
        document.head.appendChild(cursorHideStyle);
    }
}

function handleStopRecording() {
    console.log("[Content] Stopping Recording...");
    if (eventRecorder) {
        eventRecorder.stop();
        eventRecorder = null;
    }

    // Restore cursor
    if (cursorHideStyle) {
        cursorHideStyle.remove();
        cursorHideStyle = null;
    }
}

// --- Utils ---

function startCountdown(): Promise<{ canceled: boolean }> {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        Object.assign(overlay.style, {
            position: 'fixed', top: '0', left: '0', width: '100vw', height: '100vh',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            backgroundColor: 'oklch(0 0 0 / 0.5)', zIndex: '2147483647',
            cursor: 'pointer'
        });
        document.body.appendChild(overlay);

        // Create the countdown number container with ring
        const countdownContainer = document.createElement('div');
        const primaryColor = 'oklch(0.58 0.19 290)';
        Object.assign(countdownContainer.style, {
            position: 'relative',
            color: primaryColor,
            fontSize: '120px',
            fontWeight: 'bold',
            fontFamily: "'Satoshi', sans-serif",
            width: '200px',
            height: '200px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: `6px solid ${primaryColor}`,
            borderRadius: '50%',
            backgroundColor: 'oklch(0.93 0.015 75)'
        });

        // Create blur background behind the circle
        const blurBackground = document.createElement('div');
        Object.assign(blurBackground.style, {
            position: 'absolute',
            width: '100%',
            height: '100%',
            borderRadius: '50%',
            backdropFilter: 'blur(40px)',
            WebkitBackdropFilter: 'blur(40px)',
            zIndex: '-1'
        });
        countdownContainer.appendChild(blurBackground);

        overlay.appendChild(countdownContainer);

        // Cancel hint below the circle
        const hint = document.createElement('div');
        Object.assign(hint.style, {
            marginTop: '24px',
            color: 'oklch(0.92 0 0 / 70%)',
            fontSize: '14px',
            fontFamily: "'Satoshi', sans-serif",
            fontWeight: '500',
            pointerEvents: 'none',
            backgroundColor: 'oklch(0.13 0.01 270)',
            padding: '6px 14px',
            borderRadius: '6px'
        });
        hint.innerText = 'Press Esc or click to cancel';
        overlay.appendChild(hint);

        let count = 3;
        countdownContainer.innerText = count.toString();
        let canceled = false;

        const cleanup = () => {
            clearInterval(interval);
            document.removeEventListener('keydown', onKey);
            overlay.remove();
        };

        const cancel = () => {
            if (canceled) return;
            canceled = true;
            cleanup();
            resolve({ canceled: true });
        };

        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') cancel();
        };

        document.addEventListener('keydown', onKey);
        overlay.addEventListener('click', cancel);

        const interval = setInterval(() => {
            count--;
            if (count > 0) {
                countdownContainer.innerText = count.toString();
            } else {
                cleanup();
                resolve({ canceled: false });
            }
        }, 1000);
    });
}

/** Lightweight DOM toast — auto-dismisses after 2s */
function showCancelToast() {
    const toast = document.createElement('div');
    Object.assign(toast.style, {
        position: 'fixed',
        top: '16px',
        left: '50%',
        transform: 'translateX(-50%) translateY(-8px)',
        padding: '12px 16px',
        borderRadius: '12px',
        backgroundColor: 'oklch(0.20 0.01 270 / 0.92)',
        color: 'oklch(0.9 0 0 / 85%)',
        fontSize: '14px',
        fontFamily: "'Satoshi', system-ui, -apple-system, sans-serif",
        fontWeight: '500',
        lineHeight: '1',
        zIndex: '2147483647',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        border: '1px solid oklch(1 0 0 / 10%)',
        transition: 'opacity 0.3s, transform 0.3s',
        opacity: '0',
        pointerEvents: 'none',
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        boxShadow: '0 8px 32px oklch(0 0 0 / 0.3)'
    });

    // Logo
    const logo = document.createElement('img');
    logo.src = chrome.runtime.getURL('icons/icon48.png');
    Object.assign(logo.style, {
        width: '20px',
        height: '20px',
        display: 'block',
        flexShrink: '0'
    });
    toast.appendChild(logo);

    const text = document.createElement('span');
    text.style.lineHeight = '1';
    text.textContent = 'Recording cancelled';
    toast.appendChild(text);

    document.body.appendChild(toast);

    // Animate in
    requestAnimationFrame(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateX(-50%) translateY(0)';
    });

    // Animate out and remove
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(-50%) translateY(-8px)';
        setTimeout(() => toast.remove(), 300);
    }, 2000);
}

/** Interactive toast shown when user switches away from the recorded tab */
function showTabSwitchToast() {
    // Singleton — don't stack if already showing
    if (document.getElementById('recordio-tab-switch-toast')) return;

    const toast = document.createElement('div');
    toast.id = 'recordio-tab-switch-toast';
    Object.assign(toast.style, {
        position: 'fixed',
        top: '16px',
        left: '50%',
        transform: 'translateX(-50%) translateY(-8px)',
        padding: '12px 16px',
        borderRadius: '12px',
        backgroundColor: 'oklch(0.20 0.01 270 / 0.92)',
        color: 'oklch(0.9 0 0 / 85%)',
        fontSize: '14px',
        fontFamily: "'Satoshi', system-ui, -apple-system, sans-serif",
        fontWeight: '500',
        lineHeight: '1',
        zIndex: '2147483647',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        border: '1px solid oklch(1 0 0 / 10%)',
        transition: 'opacity 0.3s, transform 0.3s',
        opacity: '0',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        boxShadow: '0 8px 32px oklch(0 0 0 / 0.3)'
    });

    // Logo
    const logo = document.createElement('img');
    logo.src = chrome.runtime.getURL('icons/icon48.png');
    Object.assign(logo.style, {
        width: '20px',
        height: '20px',
        display: 'block',
        flexShrink: '0'
    });
    toast.appendChild(logo);

    // Message text
    const text = document.createElement('span');
    text.style.lineHeight = '1';
    text.textContent = "You're recording another tab";
    toast.appendChild(text);

    // "Take me back" button
    const btn = document.createElement('button');
    btn.textContent = 'Take me back';
    Object.assign(btn.style, {
        padding: '6px 14px',
        borderRadius: '8px',
        border: 'none',
        backgroundColor: 'oklch(0.58 0.19 290)',
        color: '#fff',
        fontSize: '13px',
        fontFamily: "'Satoshi', system-ui, -apple-system, sans-serif",
        fontWeight: '600',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        transition: 'filter 0.15s'
    });
    btn.addEventListener('mouseenter', () => btn.style.filter = 'brightness(1.15)');
    btn.addEventListener('mouseleave', () => btn.style.filter = 'brightness(1)');
    btn.addEventListener('click', () => {
        chrome.runtime.sendMessage({ type: MSG_TYPES.SWITCH_TO_RECORDING_TAB });
        dismissToast();
    });
    toast.appendChild(btn);

    // X close button
    const close = document.createElement('button');
    close.textContent = '✕';
    Object.assign(close.style, {
        background: 'none',
        border: 'none',
        color: 'oklch(0.9 0 0 / 50%)',
        fontSize: '14px',
        cursor: 'pointer',
        padding: '2px 4px',
        lineHeight: '1',
        transition: 'color 0.15s'
    });
    close.addEventListener('mouseenter', () => close.style.color = 'oklch(0.9 0 0 / 90%)');
    close.addEventListener('mouseleave', () => close.style.color = 'oklch(0.9 0 0 / 50%)');
    close.addEventListener('click', dismissToast);
    toast.appendChild(close);

    document.body.appendChild(toast);

    // Animate in
    requestAnimationFrame(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateX(-50%) translateY(0)';
    });

    function dismissToast() {
        document.removeEventListener('visibilitychange', onVisibilityChange);
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(-50%) translateY(-8px)';
        setTimeout(() => toast.remove(), 300);
    }

    // Dismiss when leaving the tab
    function onVisibilityChange() {
        if (document.hidden) dismissToast();
    }
    document.addEventListener('visibilitychange', onVisibilityChange);

    // Auto-dismiss after 5 seconds
    setTimeout(dismissToast, 5000);
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
