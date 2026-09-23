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


import { initSentry, captureException } from '../utils/sentry';
import { MSG_TYPES, type BaseMessage } from '../shared/messageTypes';
import { EventRecorder } from './eventRecorder';
import { showCountdown } from './countdownOverlay';
import { BlurManager } from './blurManager';
import { showRegionSelect } from './regionSelectOverlay';
import { FullPageSession } from './fullPageCapture';
import type { FullPageScrollToPayload, FullPageWaitForGrowthPayload, PageInfo } from '../shared/messageTypes';

// Initialize Sentry for error tracking
initSentry('content');

// Cleanup mechanism for previous instances of THIS extension. DOM events cross
// isolated worlds, so the name carries the extension id — otherwise a second
// Recordio install (e.g. store + unpacked dev build) would tear down ours.
const CLEANUP_EVENT = `recordio-cleanup:${chrome.runtime.id}`;
window.dispatchEvent(new Event(CLEANUP_EVENT));

window.addEventListener(CLEANUP_EVENT, () => {
    if (eventRecorder) {
        eventRecorder.stop();
        eventRecorder = null;
    }
    if (hideCountdown) {
        hideCountdown();
        hideCountdown = null;
    }
    blurManager.disable();
    if (hideRegionSelect) {
        hideRegionSelect();
        hideRegionSelect = null;
    }
    fullPage.finish();
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
// Screenshots (plans/screenshots): region overlay + full-page page-side session
let hideRegionSelect: (() => void) | null = null;
const fullPage = new FullPageSession(() => blurManager.disable());

/**
 * Content scripts run without Sentry's global handlers (they would clash
 * with the host page's), so screenshot failures are captured explicitly
 * here — the stack lives in this context — and only the message crosses
 * to the background.
 */
function reportContentError(err: unknown): string {
    const error = err instanceof Error ? err : new Error(String(err));
    captureException(error);
    return error.message;
}

function getPageInfo(): PageInfo {
    return {
        url: location.href,
        title: document.title,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        devicePixelRatio: window.devicePixelRatio,
        visualScale: window.visualViewport?.scale ?? 1,
        scrollX: window.scrollX,
        scrollY: window.scrollY,
    };
}

// --- Message Listener ---
// Returns true for the screenshot handlers that respond asynchronously.
const handleMessage = (message: any, _sender: chrome.runtime.MessageSender, sendResponse: (response?: unknown) => void): boolean | void => {
    switch (message.type) {
        // ── Screenshots ──────────────────────────────────────────────────────
        case MSG_TYPES.BACKGROUND_CONTENT_GET_PAGE_INFO:
            sendResponse(getPageInfo());
            return;

        case MSG_TYPES.BACKGROUND_CONTENT_START_REGION_SELECT:
            try {
                blurManager.disable();
                hideRegionSelect?.();
                hideRegionSelect = showRegionSelect(
                    (selection) => {
                        hideRegionSelect = null;
                        chrome.runtime.sendMessage({ type: MSG_TYPES.CONTENT_REGION_SELECTED, payload: selection }).catch(() => {});
                    },
                    () => {
                        hideRegionSelect = null;
                        chrome.runtime.sendMessage({ type: MSG_TYPES.CONTENT_REGION_CANCELLED }).catch(() => {});
                    },
                );
                sendResponse({ ok: true });
            } catch (err) {
                hideRegionSelect = null;
                sendResponse({ error: reportContentError(err) });
            }
            return;

        case MSG_TYPES.BACKGROUND_CONTENT_CANCEL_REGION_SELECT:
            if (hideRegionSelect) {
                hideRegionSelect();
                hideRegionSelect = null;
                chrome.runtime.sendMessage({ type: MSG_TYPES.CONTENT_REGION_CANCELLED }).catch(() => {});
            }
            return;

        // A user cancel resolves with `cancelled: true`; a rejection is a real
        // bug, reported here (with its stack) and surfaced to the background
        // as `{ error }` so it fails the capture instead of looking like a cancel.
        case MSG_TYPES.BACKGROUND_CONTENT_FULLPAGE_PREPARE:
            fullPage.prepare().then(sendResponse, (err) => {
                fullPage.finish();
                sendResponse({ error: reportContentError(err) });
            });
            return true;

        case MSG_TYPES.BACKGROUND_CONTENT_FULLPAGE_SCROLL_TO:
            fullPage.scrollTo(message.payload as FullPageScrollToPayload).then(sendResponse, (err) => {
                sendResponse({ error: reportContentError(err) });
            });
            return true;

        case MSG_TYPES.BACKGROUND_CONTENT_FULLPAGE_WAIT_FOR_GROWTH:
            fullPage.waitForGrowth(message.payload as FullPageWaitForGrowthPayload).then(sendResponse, (err) => {
                sendResponse({ error: reportContentError(err) });
            });
            return true;

        case MSG_TYPES.BACKGROUND_CONTENT_FULLPAGE_FINISH:
            fullPage.finish();
            sendResponse({ ok: true });
            return;

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
