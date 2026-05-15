/**
 * @fileoverview Background Service Worker
 *
 * Orchestrates all recording sessions:
 *
 * TAB MODE (via popup):
 *   Popup sends POPUP_START_TAB_RECORDING → background calls tabCapture.getMediaStreamId(),
 *   creates an offscreen document, passes the stream ID + settings via BACKGROUND_OFFSCREEN_INIT.
 *   The offscreen doc runs VideoRecorder and reports back with OFFSCREEN_DONE when done.
 *
 * WINDOW/DESKTOP MODE (via controller tab):
 *   Popup sends POPUP_OPEN_CONTROLLER → background opens the controller tab (existing flow).
 *   Controller reports CONTROLLER_STARTED_RECORDING / CONTROLLER_STOPPED_RECORDING.
 *
 * IN BOTH MODES:
 *   Popup sends POPUP_PAUSE/RESUME/CANCEL/FINISH → background routes to the active destination
 *   (offscreen or controller tab) based on recordingState.recordingMode.
 *
 * Website handoff (external message port streaming) is unchanged.
 */

import { initSentry, captureException } from '../utils/sentry';
import { trackRecordingStarted, trackRecordingPaused, trackRecordingResumed, trackRecordingFinished, trackRecordingCanceled, trackRecordingError, getDistinctId, identifyUser } from '../utils/mixpanel';

import { BADGE_RECORDING_COLOR_HEX, BADGE_PAUSED_COLOR_HEX, BADGE_TEXT_COLOR_HEX } from '../utils/colors';
import { MSG_TYPES, type RecordingState, STORAGE_KEYS } from '../shared/messageTypes';
import {
    BRIDGE_MSG,
    buildImportUrl,
    getEditorOrigin,
    type HandoffCompletePayload,
} from '@shared/types/bridge';
import type { RawRecording } from '@shared/types';

// Initialize Sentry for error tracking
initSentry('background');

// --- State Management ---

const DEFAULT_STATE: RecordingState = {
    isRecording: false,
    controllerTabId: null,
    startTime: 0,
    currentSessionId: null,
    isCurrentWindow: false,
    originalTabId: null,
    hasAudio: false,
    hasCamera: false,
    isPaused: false,
    totalPausedMs: 0,
    pauseStartTime: 0,
    recordingMode: null,
    captureType: null,
};

// Mic/camera config from the popup, held until the controller selects a source.
// Not persisted to session storage — ephemeral within the SW lifetime.
let pendingRecordingConfig: { hasAudio: boolean; audioDeviceId?: string; hasCamera: boolean; videoDeviceId?: string } | null = null;

let currentState: RecordingState | null = null;
let stateReady: Promise<void> | null = null;

async function doEnsureState() {
    try {
        const result = await chrome.storage.session.get(STORAGE_KEYS.RECORDING_STATE);
        if (result[STORAGE_KEYS.RECORDING_STATE]) {
            currentState = result[STORAGE_KEYS.RECORDING_STATE] as RecordingState;
        } else {
            currentState = { ...DEFAULT_STATE };
        }
    } catch (e) {
        console.error("Failed to restore state:", e);
        captureException(e instanceof Error ? e : new Error(String(e)));
        currentState = { ...DEFAULT_STATE };
    }
}

function ensureState() {
    if (!stateReady) {
        stateReady = doEnsureState();
    }
    return stateReady;
}

// Start State Loading Immediately
ensureState();

async function saveState(newState: Partial<RecordingState>) {
    if (!currentState) currentState = { ...DEFAULT_STATE };
    currentState = { ...currentState, ...newState };
    await chrome.storage.session.set({ [STORAGE_KEYS.RECORDING_STATE]: currentState });
}

// --- Badge Timer Management ---

let badgeTimerIntervalId: ReturnType<typeof setInterval> | null = null;

function formatRecordingTime(elapsedMs: number): string {
    const totalSeconds = Math.floor(elapsedMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const paddedSeconds = seconds.toString().padStart(2, '0');
    return `${minutes}:${paddedSeconds}`;
}

function updateBadge() {
    if (!currentState?.isRecording || !currentState.startTime) return;

    const isPaused = currentState.isPaused;
    const elapsed = Date.now() - currentState.startTime - (currentState.totalPausedMs || 0)
        - (isPaused && currentState.pauseStartTime ? Date.now() - currentState.pauseStartTime : 0);
    const text = formatRecordingTime(elapsed);

    chrome.action.setBadgeText({ text });
    chrome.action.setBadgeBackgroundColor({ color: isPaused ? BADGE_PAUSED_COLOR_HEX : BADGE_RECORDING_COLOR_HEX });
    chrome.action.setBadgeTextColor({ color: BADGE_TEXT_COLOR_HEX });
}

function startBadgeTimer() {
    updateBadge();
    badgeTimerIntervalId = setInterval(updateBadge, 1000);
}

function stopBadgeTimer() {
    if (badgeTimerIntervalId) {
        clearInterval(badgeTimerIntervalId);
        badgeTimerIntervalId = null;
    }
    chrome.action.setBadgeText({ text: '' });
}

// --- Controller Tab Management ---

async function closeControllerTab(tabId: number | null) {
    if (tabId) {
        chrome.tabs.remove(tabId).catch(() => { });
    }
}

async function openControllerTab(): Promise<number> {
    const tab = await chrome.tabs.create({
        url: chrome.runtime.getURL('src/controller/index.html'),
        active: true,
        pinned: true
    });

    if (!tab || !tab.id) throw new Error("Failed to create controller tab");
    return tab.id;
}

// --- Content Script Injection ---

import contentScriptPath from '../content/content.ts?script';

async function openWelcomeTab(): Promise<void> {
    await chrome.tabs.create({
        url: chrome.runtime.getURL('src/welcome/index.html'),
        active: true,
    });
}

chrome.runtime.onInstalled.addListener(async (details) => {
    // Open welcome page on fresh install (not updates)
    if (details.reason === 'install') {
        await ensureState();
        await openWelcomeTab();
    }

    // Set farewell page for uninstall
    chrome.runtime.setUninstallURL(getEditorOrigin() + '/uninstall');

    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
        if (tab.id && tab.url && (tab.url.startsWith("http://") || tab.url.startsWith("https://") || tab.url.startsWith("file://"))) {
            try {
                await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    files: [contentScriptPath]
                });
            } catch (err: any) {
                console.warn(`[background] Failed to inject into tab ${tab.id}`, err.message);
            }
        }
    }
});

// --- Offscreen Document Management ---

const OFFSCREEN_URL = 'src/offscreen/offscreen.html';

async function ensureOffscreenDocument(): Promise<void> {
    // Chrome MV3: only one offscreen document can exist at a time
    const existing = await (chrome.offscreen as any).hasDocument?.();
    if (existing) return;
    await (chrome.offscreen as any).createDocument({
        url: chrome.runtime.getURL(OFFSCREEN_URL),
        reasons: ['USER_MEDIA'],
        justification: 'Record tab audio/video for Recordio screen recording',
    });
}

async function closeOffscreenDocument(): Promise<void> {
    try {
        await (chrome.offscreen as any).closeDocument();
    } catch {
        // Already closed — ignore
    }
}

// --- Cleanup Helpers ---

/** Broadcasts STOP_RECORDING_EVENTS to all tabs (stops event capture in content scripts). */
async function broadcastStopEvents(sessionId: string | null) {
    const msg = { type: MSG_TYPES.STOP_RECORDING_EVENTS, payload: { sessionId } };
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
        if (tab.id) chrome.tabs.sendMessage(tab.id, msg).catch(() => { });
    }
}

/** Full cleanup: stops badge, resets state, closes offscreen doc if tab mode */
async function cleanupRecording(options: { closeOffscreen?: boolean; closeController?: boolean } = {}) {
    stopBadgeTimer();

    const sessionId = currentState?.currentSessionId;
    const controllerTabId = currentState?.controllerTabId;

    await broadcastStopEvents(sessionId ?? null);
    await saveState({ ...DEFAULT_STATE });

    if (options.closeOffscreen) {
        await closeOffscreenDocument();
    }
    if (options.closeController && controllerTabId) {
        closeControllerTab(controllerTabId);
    }
}

// Note: chrome.action.onClicked is NOT registered here — the popup handles the icon click.

// --- Countdown Helper ---

/**
 * Sends BACKGROUND_CONTENT_SHOW_COUNTDOWN to the given tab's content script,
 * then waits for either CONTENT_COUNTDOWN_COMPLETE (returns true) or
 * CONTENT_COUNTDOWN_CANCELLED (returns false).
 */
function waitForCountdownResult(tabId: number): Promise<boolean> {
    return new Promise((resolve) => {
        const handler = (message: any, sender: chrome.runtime.MessageSender) => {
            // Only accept responses from the specific tab we showed the countdown on
            if (sender.tab?.id !== tabId) return;
            if (message.type === MSG_TYPES.CONTENT_COUNTDOWN_COMPLETE) {
                chrome.runtime.onMessage.removeListener(handler);
                resolve(true);
            } else if (message.type === MSG_TYPES.CONTENT_COUNTDOWN_CANCELLED) {
                chrome.runtime.onMessage.removeListener(handler);
                resolve(false);
            }
        };
        chrome.runtime.onMessage.addListener(handler);

        chrome.tabs.sendMessage(tabId, {
            type: MSG_TYPES.BACKGROUND_CONTENT_SHOW_COUNTDOWN,
        }).then(() => {
            console.log('[Background] SHOW_COUNTDOWN sent to tab', tabId);
        }).catch((err) => {
            // Content script not injectable (e.g. chrome:// page) — skip countdown
            console.warn('[Background] SHOW_COUNTDOWN failed (skipping):', err?.message);
            chrome.runtime.onMessage.removeListener(handler);
            resolve(true);
        });
    });
}

// --- Message Handlers ---

async function handleStopSession(sendResponse: Function) {
    stopBadgeTimer();
    await ensureState();

    // Track recording_finished
    if (currentState?.isRecording && currentState.startTime) {
        const elapsed_ms = Date.now() - currentState.startTime;
        const duration_ms = elapsed_ms - (currentState.totalPausedMs || 0);
        trackRecordingFinished({
            capture_type: currentState.captureType,
            elapsed_ms,
            duration_ms,
            hasAudio: currentState.hasAudio,
            hasCamera: currentState.hasCamera,
        });
    }

    await broadcastStopEvents(currentState?.currentSessionId ?? null);

    // NOTE: We do NOT send STOP_RECORDING_VIDEO to the controller tab.
    // The controller listens for STOP_SESSION directly via chrome.runtime.onMessage
    // and handles its own recorder.finish() + save. This avoids chrome.tabs.sendMessage
    // which can cause Chrome to briefly activate the controller tab (visible in window recordings).
    //
    // The controller will call CONTROLLER_STOPPED_RECORDING when it's done saving,
    // which triggers handleRecordingFinished() to clean up state and open the import page.

    sendResponse({ success: true });
}

/** Called after the controller has finished saving the recording */
async function handleRecordingFinished(sessionId: string | null, controllerTabId: number | null) {
    // Open website import page
    try {
        if (sessionId) {
            const importUrl = buildImportUrl(sessionId, chrome.runtime.id);
            await chrome.tabs.create({ url: importUrl });
        }
    } catch (e) {
        captureException(e instanceof Error ? e : new Error(String(e)));
    }

    // Full reset — avoids leaving stale isPaused / recordingMode / hasAudio etc.
    await saveState({ ...DEFAULT_STATE });

    if (controllerTabId) {
        closeControllerTab(controllerTabId);
    }
}

/** Called when a recording save fails in the controller or offscreen context */
async function handleRecordingFailed(error: string, mode: 'tab' | 'controller') {
    captureException(new Error(`[Recording save failed - ${mode}] ${error}`));
    stopBadgeTimer();

    trackRecordingError({
        capture_type: currentState?.captureType ?? null,
        error,
        mode,
    });

    // Show error badge to draw attention to the extension icon
    chrome.action.setBadgeText({ text: '!' });
    chrome.action.setBadgeBackgroundColor({ color: '#FF6B35' });
    chrome.action.setBadgeTextColor({ color: '#FFFFFF' });

    // Store error so the popup can display it when opened
    await chrome.storage.session.set({
        [STORAGE_KEYS.RECORDING_ERROR]: { message: error || 'An error occurred while saving your recording.' },
    });

    // Reset recording state
    await saveState({ ...DEFAULT_STATE });

    // Tab mode: close the offscreen doc and try to open the popup
    // (controller mode already shows the error in its own UI)
    if (mode === 'tab') {
        await closeOffscreenDocument();
        (chrome.action as any).openPopup?.().catch(() => {});
    }
}

function handleGetRecordingState(_sender: chrome.runtime.MessageSender, sendResponse: Function) {
    if (!currentState) return sendResponse({ isRecording: false, startTime: 0 });

    sendResponse({
        isRecording: currentState.isRecording,
        startTime: currentState.startTime,
        hasAudio: currentState.hasAudio,
        hasCamera: currentState.hasCamera,
        isCurrentWindow: currentState.isCurrentWindow,
        originalTabId: currentState.originalTabId,
    });
}

/** Called when the controller tab is lost mid-recording (closed or navigated away).
 *  This is a failed/aborted recording — just reset state, don't open import. */
async function handleRecordingAborted(controllerTabId: number | null) {
    stopBadgeTimer();
    await broadcastStopEvents(currentState?.currentSessionId ?? null);
    // Full reset — no import page for aborted recordings
    await saveState({ ...DEFAULT_STATE });
    if (controllerTabId) {
        closeControllerTab(controllerTabId);
    }
}

// --- Tab Removal Listener ---
// Detect if the controller tab or the recorded tab is closed during recording
chrome.tabs.onRemoved.addListener(async (tabId) => {
    await ensureState();
    if (!currentState) return;

    const isControllerTab = currentState.controllerTabId === tabId;
    const isRecordedTab = currentState.recordingMode === 'tab' && currentState.originalTabId === tabId;

    if (isRecordedTab && currentState.isRecording) {
        // The tab being recorded was closed — cancel and clean up (no import page)
        chrome.runtime.sendMessage({ type: MSG_TYPES.BACKGROUND_OFFSCREEN_CANCEL }).catch(() => { });
        await cleanupRecording({ closeOffscreen: true });
    } else if (isControllerTab && currentState.isRecording) {
        // Controller closed while recording — aborted, just clean up
        await handleRecordingAborted(null); // tab is already gone
    } else if (isControllerTab && !currentState.isRecording) {
        // Controller closed before recording started — clear ref and discard pending config
        pendingRecordingConfig = null;
        await saveState({ controllerTabId: null });
    }
});

// --- Tab Navigation Listener ---
// Detect if the controller tab navigates away (user types a URL, etc.)
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
    if (!changeInfo.url) return; // Only care about URL changes

    await ensureState();
    if (!currentState || currentState.controllerTabId !== tabId) return;

    // Check if navigated away from the controller page
    const controllerUrl = chrome.runtime.getURL('src/controller/index.html');
    if (!changeInfo.url.startsWith(controllerUrl)) {
        if (currentState.isRecording) {
            // Navigated away during recording — aborted, just clean up
            await handleRecordingAborted(tabId);
        } else {
            // Navigated away before recording — clear ref and discard pending config
            pendingRecordingConfig = null;
            await saveState({ controllerTabId: null });
        }
    }
});

// --- Main Listener ---

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    (async () => {
        await ensureState();
        if (!currentState) return;

        switch (message.type) {

            // ── Existing: controller/content-script messages ─────────────────

            case MSG_TYPES.STOP_SESSION:
                handleStopSession(sendResponse);
                break;

            case MSG_TYPES.CONTENT_GET_RECORDING_STATE:
                handleGetRecordingState(_sender, sendResponse);
                break;

            case MSG_TYPES.RECORDING_FAILED: {
                const { error, mode } = message.payload || {};
                await handleRecordingFailed(error || 'Unknown error', mode || 'tab');
                sendResponse({ success: true });
                break;
            }

            case MSG_TYPES.CONTROLLER_STARTED_RECORDING: {
                const { sessionId, isCurrentWindow, hasAudio, hasCamera, originalTabId, captureType } = message.payload || {};
                const syncTimestamp = Date.now();

                await ProjectStorage.clearAll();

                await saveState({
                    isRecording: true,
                    recordingMode: 'controller',
                    controllerTabId: _sender.tab?.id || currentState.controllerTabId,
                    startTime: syncTimestamp,
                    currentSessionId: sessionId,
                    isCurrentWindow: isCurrentWindow || false,
                    originalTabId: originalTabId || currentState.originalTabId,
                    hasAudio: hasAudio || false,
                    hasCamera: hasCamera || false,
                    isPaused: false,
                    totalPausedMs: 0,
                    pauseStartTime: 0,
                    captureType: captureType || null,
                });

                startBadgeTimer();

                trackRecordingStarted({
                    capture_type: captureType || 'another_window',
                    hasAudio: hasAudio || false,
                    hasCamera: hasCamera || false,
                });

                sendResponse({ success: true, startTime: syncTimestamp });
                break;
            }

            case MSG_TYPES.CONTROLLER_STOPPED_RECORDING: {
                // Controller finished saving — open import page and clean up.
                // (handleStopSession / cleanupRecording may already have cleared badge etc.)
                stopBadgeTimer();
                await handleRecordingFinished(
                    currentState?.currentSessionId || null,
                    currentState?.controllerTabId || null
                );
                sendResponse({ success: true });
                break;
            }

            // ── New: Popup → Background ──────────────────────────────────────

            case MSG_TYPES.POPUP_START_TAB_RECORDING: {
                // Guard: only one recording at a time
                if (currentState.isRecording) {
                    sendResponse({ success: false, error: 'A recording is already in progress' });
                    return;
                }

                // Close any open controller tab before starting tab recording
                if (currentState.controllerTabId) {
                    await closeControllerTab(currentState.controllerTabId);
                    await saveState({ controllerTabId: null });
                }

                const { hasAudio, audioDeviceId, hasVideo, videoDeviceId } = message.payload || {};

                try {
                    // Get the currently active tab to capture
                    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
                    if (!activeTab?.id) throw new Error('No active tab found');

                    // Create the offscreen document early so we can warm up camera/mic
                    // during the countdown — by the time recording starts the camera is adjusted.
                    await ensureOffscreenDocument();

                    // Fire warmup (non-blocking). Runs in parallel with the countdown (~3s),
                    // so camera auto-exposure has time to settle before recording begins.
                    if (hasVideo || hasAudio) {
                        chrome.runtime.sendMessage({
                            type: MSG_TYPES.BACKGROUND_OFFSCREEN_PREPARE,
                            payload: { hasAudio, audioDeviceId, hasVideo, videoDeviceId },
                        }).catch(() => { /* non-fatal: INIT will open fresh streams */ });
                    }

                    // Kick off the countdown overlay on the tab. We respond to the popup
                    // immediately so it can close, then continue async once the countdown resolves.
                    const countdownPromise = waitForCountdownResult(activeTab.id);
                    sendResponse({ success: true });

                    const countdownStarted = await countdownPromise;
                    if (!countdownStarted) {
                        // User cancelled during countdown — release warm streams and offscreen doc.
                        chrome.runtime.sendMessage({ type: MSG_TYPES.BACKGROUND_OFFSCREEN_CANCEL }).catch(() => {});
                        await closeOffscreenDocument();
                        return;
                    }

                    // Get a stream ID for tab capture (no picker shown to user)
                    const tabStreamId = await new Promise<string>((resolve, reject) => {
                        chrome.tabCapture.getMediaStreamId(
                            { targetTabId: activeTab.id },
                            (id: string) => {
                                if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
                                else resolve(id);
                            }
                        );
                    });

                    // Get the tab's CSS viewport size and device pixel ratio.
                    // Used for trackableContentRect and event coordinate scaling (CSS → device px).
                    // Also used to compute a capture resolution cap: we request at most 4K,
                    // so a 5K display gets downscaled, but a smaller tab stays at its natural size.
                    let tabViewportSize: { width: number; height: number } | undefined;
                    let captureMaxWidth: number | undefined;
                    let captureMaxHeight: number | undefined;
                    try {
                        const [{ result }] = await chrome.scripting.executeScript({
                            target: { tabId: activeTab.id },
                            func: () => ({
                                width: window.innerWidth,
                                height: window.innerHeight,
                                dpr: window.devicePixelRatio,
                            }),
                        });
                        const r = result as { width: number; height: number; dpr: number };
                        tabViewportSize = { width: r.width, height: r.height };

                        // Compute device-pixel resolution and cap at 4K (3840×2160).
                        // Use a proportional scale so both constraints share the same aspect
                        // ratio as the source — Chrome letterboxes if the constraints form a
                        // different aspect ratio (e.g. maxWidth hits 3840 but maxHeight is left
                        // at the full source height, causing black bars top/bottom).
                        const deviceW = Math.round(r.width * r.dpr);
                        const deviceH = Math.round(r.height * r.dpr);
                        const capScale = Math.min(3840 / deviceW, 2160 / deviceH, 1);
                        captureMaxWidth = Math.round(deviceW * capScale);
                        captureMaxHeight = Math.round(deviceH * capScale);
                    } catch {
                        // Non-injectable tab (e.g. chrome:// page) — proceed without constraints
                    }

                    const sessionId = crypto.randomUUID();
                    const syncTimestamp = Date.now();

                    await ProjectStorage.clearAll();

                    // Send init payload to offscreen (doc was already created before countdown)
                    await chrome.runtime.sendMessage({
                        type: MSG_TYPES.BACKGROUND_OFFSCREEN_INIT,
                        payload: { tabStreamId, hasAudio, audioDeviceId, hasVideo, videoDeviceId, sessionId, tabViewportSize, captureMaxWidth, captureMaxHeight },
                    });

                    await saveState({
                        isRecording: true,
                        recordingMode: 'tab',
                        startTime: syncTimestamp,
                        currentSessionId: sessionId,
                        hasAudio: hasAudio || false,
                        hasCamera: hasVideo || false,
                        isPaused: false,
                        totalPausedMs: 0,
                        pauseStartTime: 0,
                        controllerTabId: null,
                        isCurrentWindow: false,
                        originalTabId: activeTab.id,
                        captureType: 'tab',
                    });

                    startBadgeTimer();

                    // Tell the recorded tab's content script to start capturing user events.
                    // The offscreen document will receive CAPTURE_USER_EVENT messages directly
                    // via chrome.runtime.onMessage and feed them into VideoRecorder.
                    chrome.tabs.sendMessage(activeTab.id, {
                        type: MSG_TYPES.START_RECORDING_EVENTS,
                        payload: { startTime: syncTimestamp, sessionId },
                    }).catch(() => { });

                    trackRecordingStarted({
                        capture_type: 'tab',
                        hasAudio: hasAudio || false,
                        hasCamera: hasVideo || false,
                    });
                } catch (err: any) {
                    console.error('[Background] POPUP_START_TAB_RECORDING failed:', err);
                    captureException(err instanceof Error ? err : new Error(String(err)));
                    await closeOffscreenDocument();
                    // Popup is already closed at this point — error is handled silently.
                }
                break;
            }

            case MSG_TYPES.POPUP_OPEN_SOURCE_PICKER: {
                // Open controller; recording starts automatically as soon as the user picks a source
                if (currentState.isRecording) {
                    sendResponse({ success: false, error: 'A recording is already in progress' });
                    return;
                }

                const { hasAudio, audioDeviceId, hasCamera, videoDeviceId } = message.payload || {};
                pendingRecordingConfig = { hasAudio: !!hasAudio, audioDeviceId, hasCamera: !!hasCamera, videoDeviceId };

                const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
                const originalTabId = activeTab?.id || null;

                if (currentState.controllerTabId) {
                    await closeControllerTab(currentState.controllerTabId);
                }

                const controllerTabId = await openControllerTab();
                await saveState({ controllerTabId, originalTabId });
                sendResponse({ success: true });
                break;
            }

            case MSG_TYPES.CONTROLLER_READY: {
                // Controller tab just loaded — respond with the pending mic/camera config
                // so it can prewarm streams while the OS source picker is open.
                sendResponse(pendingRecordingConfig ?? null);
                break;
            }

            case MSG_TYPES.CONTROLLER_SOURCE_SELECTED: {
                // Source picked — start recording immediately, no countdown
                const config = pendingRecordingConfig;
                pendingRecordingConfig = null;

                const sessionId = crypto.randomUUID();
                await saveState({ currentSessionId: sessionId });

                if (currentState.controllerTabId) {
                    chrome.tabs.sendMessage(currentState.controllerTabId, {
                        type: MSG_TYPES.BACKGROUND_CONTROLLER_START_RECORDING,
                        payload: {
                            hasAudio: config?.hasAudio ?? false,
                            audioDeviceId: config?.audioDeviceId,
                            hasCamera: config?.hasCamera ?? false,
                            videoDeviceId: config?.videoDeviceId,
                            sessionId,
                        },
                    }).catch(() => { });
                }

                sendResponse({ success: true });
                break;
            }

            case MSG_TYPES.POPUP_PAUSE_RECORDING: {
                if (!currentState.isRecording || currentState.isPaused) {
                    sendResponse({ success: false });
                    return;
                }

                const pauseStartTime = Date.now();
                await saveState({ isPaused: true, pauseStartTime });

                trackRecordingPaused({
                    capture_type: currentState.captureType,
                    elapsed_ms: currentState.startTime ? pauseStartTime - currentState.startTime - (currentState.totalPausedMs || 0) : 0,
                });

                // Immediately flip badge to red; interval keeps ticking (elapsed frozen by isPaused logic)
                updateBadge();

                if (currentState.recordingMode === 'tab') {
                    chrome.runtime.sendMessage({ type: MSG_TYPES.BACKGROUND_OFFSCREEN_PAUSE }).catch(() => { });
                } else if (currentState.recordingMode === 'controller' && currentState.controllerTabId) {
                    chrome.tabs.sendMessage(currentState.controllerTabId, { type: MSG_TYPES.BACKGROUND_CONTROLLER_PAUSE }).catch(() => { });
                }

                sendResponse({ success: true });
                break;
            }

            case MSG_TYPES.POPUP_RESUME_RECORDING: {
                if (!currentState.isRecording || !currentState.isPaused) {
                    sendResponse({ success: false });
                    return;
                }

                const addedPausedMs = currentState.pauseStartTime
                    ? Date.now() - currentState.pauseStartTime
                    : 0;

                const newTotalPausedMs = (currentState.totalPausedMs || 0) + addedPausedMs;
                await saveState({
                    isPaused: false,
                    pauseStartTime: 0,
                    totalPausedMs: newTotalPausedMs,
                });

                trackRecordingResumed({
                    capture_type: currentState.captureType,
                    elapsed_ms: currentState.startTime ? Date.now() - currentState.startTime - newTotalPausedMs : 0,
                });

                // Immediately flip badge back to green; interval already running
                updateBadge();

                if (currentState.recordingMode === 'tab') {
                    chrome.runtime.sendMessage({ type: MSG_TYPES.BACKGROUND_OFFSCREEN_RESUME }).catch(() => { });
                } else if (currentState.recordingMode === 'controller' && currentState.controllerTabId) {
                    chrome.tabs.sendMessage(currentState.controllerTabId, { type: MSG_TYPES.BACKGROUND_CONTROLLER_RESUME }).catch(() => { });
                }

                sendResponse({ success: true });
                break;
            }

            case MSG_TYPES.POPUP_CANCEL_RECORDING: {
                if (!currentState.isRecording) {
                    sendResponse({ success: false });
                    return;
                }

                trackRecordingCanceled({
                    capture_type: currentState.captureType,
                    elapsed_ms: currentState.startTime ? Date.now() - currentState.startTime - (currentState.totalPausedMs || 0) : 0,
                });

                if (currentState.recordingMode === 'tab') {
                    // Tell offscreen to abort; wait for OFFSCREEN_DONE before full cleanup
                    chrome.runtime.sendMessage({ type: MSG_TYPES.BACKGROUND_OFFSCREEN_CANCEL }).catch(() => { });
                    // Cleanup happens when OFFSCREEN_DONE arrives with cancelled:true
                } else if (currentState.recordingMode === 'controller' && currentState.controllerTabId) {
                    chrome.tabs.sendMessage(currentState.controllerTabId, { type: MSG_TYPES.BACKGROUND_CONTROLLER_CANCEL }).catch(() => { });
                    // Cleanup: controller will close itself and analytics are skipped for cancel
                    await cleanupRecording({ closeController: false });
                }

                sendResponse({ success: true });
                break;
            }

            case MSG_TYPES.POPUP_FINISH_RECORDING: {
                if (!currentState.isRecording) {
                    sendResponse({ success: false });
                    return;
                }

                if (currentState.recordingMode === 'tab') {
                    // Tell offscreen to finish; result arrives via OFFSCREEN_DONE
                    chrome.runtime.sendMessage({ type: MSG_TYPES.BACKGROUND_OFFSCREEN_FINISH }).catch(() => { });
                    // handleStopSession does analytics + content script broadcast
                    handleStopSession(() => { });
                } else if (currentState.recordingMode === 'controller' && currentState.controllerTabId) {
                    // Send STOP_SESSION: background's own handler does analytics + broadcast,
                    // and the controller's onMessage listener calls stopRecording().
                    chrome.runtime.sendMessage({ type: MSG_TYPES.STOP_SESSION }).catch(() => { });
                }

                sendResponse({ success: true });
                break;
            }

            // ── New: Offscreen → Background ──────────────────────────────────

            case MSG_TYPES.OFFSCREEN_DONE: {
                const { cancelled, sessionId: doneSessionId } = message.payload || {};

                // Guard: if state was already cleaned up (e.g. the recorded tab was closed
                // and cleanupRecording already ran), don't double-broadcast or double-reset.
                if (!currentState.isRecording && currentState.recordingMode !== 'tab') {
                    sendResponse({ success: true });
                    return;
                }

                if (cancelled) {
                    // Cancelled — just clean up, no import page
                    await cleanupRecording({ closeOffscreen: true });
                } else {
                    // Finished — stop badge, open import page, then clean up
                    stopBadgeTimer();
                    await handleRecordingFinished(doneSessionId || currentState.currentSessionId, null);
                    await closeOffscreenDocument();
                }

                sendResponse({ success: true });
                break;
            }
        }
    })();
    return true; // Async response
});

// ============================================
// External Message Handler (from website)
// ============================================

import { ProjectStorage } from '../storage/projectStorage';
import {
    PORT_MSG,
    HANDOFF_PORT_NAME,
    CHUNK_SIZE,
    type HandoffRequestPayload,
    type HandoffMetadataResponse,
    type HandoffErrorResponse,
    type StartStreamPayload,
    type ChunkPayload,
    type IdentifyUserPayload,
} from '@shared/types/bridge';

// Cache for pending handoff data (between metadata request and stream)
const pendingHandoffs = new Map<string, {
    recording: RawRecording;
    screenBlob: Blob;
    cameraBlob?: Blob;
    micBlob?: Blob;
}>();

chrome.runtime.onMessageExternal.addListener((message, _sender, sendResponse) => {
    (async () => {
        switch (message.type) {
            case BRIDGE_MSG.HANDOFF_REQUEST:
                await handleHandoffRequest(message.payload as HandoffRequestPayload, sendResponse);
                break;

            case BRIDGE_MSG.HANDOFF_COMPLETE:
                await handleHandoffComplete(message.payload as HandoffCompletePayload);
                sendResponse({ success: true });
                break;

            case BRIDGE_MSG.OPEN_CONTROLLER:
                await openControllerTab();
                sendResponse({ success: true });
                break;

            case BRIDGE_MSG.IDENTIFY_USER: {
                const { email } = message.payload as IdentifyUserPayload;
                await identifyUser(email);
                sendResponse({ success: true });
                break;
            }

            default:
                sendResponse({ success: false, error: 'Unknown message type', code: 'UNKNOWN' });
        }
    })();

    return true;
});

async function handleHandoffRequest(payload: HandoffRequestPayload, sendResponse: Function) {
    const { recordingId } = payload;

    try {
        const recording = await ProjectStorage.loadRawRecording(recordingId);

        if (!recording) {
            console.error('[Background] Recording not found:', recordingId);
            captureException(new Error(`Recording not found: ${recordingId}`));
            const errorResponse: HandoffErrorResponse = {
                success: false,
                error: 'Recording not found',
                code: 'NOT_FOUND',
            };
            sendResponse(errorResponse);
            return;
        }

        if (!recording.screenSource.storagePath) {
            throw new Error('Screen source has no storage URL');
        }
        const screenBlobId = recording.screenSource.storagePath.replace('recordio-blob://', '');
        const screenBlob = await ProjectStorage.getRecordingBlob(screenBlobId);

        if (!screenBlob) {
            throw new Error('Screen blob not found');
        }

        let cameraBlob: Blob | undefined;
        if (recording.cameraSource?.storagePath) {
            const cameraBlobId = recording.cameraSource.storagePath.replace('recordio-blob://', '');
            cameraBlob = await ProjectStorage.getRecordingBlob(cameraBlobId);
        }

        let micBlob: Blob | undefined;
        if (recording.microphoneSource?.storagePath) {
            const micBlobId = recording.microphoneSource.storagePath.replace('recordio-blob://', '');
            micBlob = await ProjectStorage.getRecordingBlob(micBlobId);
        }

        pendingHandoffs.set(recordingId, { recording, screenBlob, cameraBlob, micBlob });

        const extensionDistinctId = await getDistinctId();
        const response: HandoffMetadataResponse = {
            success: true,
            recording,
            screenVideoSize: screenBlob.size,
            screenVideoType: screenBlob.type,
            cameraVideoSize: cameraBlob?.size,
            cameraVideoType: cameraBlob?.type,
            micAudioSize: micBlob?.size,
            micAudioType: micBlob?.type,
            extensionDistinctId,
        };
        sendResponse(response);

    } catch (error) {
        console.error('[Background] Error fetching recording:', error);
        captureException(error instanceof Error ? error : new Error(String(error)));
        const errorResponse: HandoffErrorResponse = {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            code: 'STORAGE_ERROR',
        };
        sendResponse(errorResponse);
    }
}

chrome.runtime.onConnectExternal.addListener((port) => {
    if (port.name !== HANDOFF_PORT_NAME) {
        console.warn('[Background] Unknown port connection:', port.name);
        return;
    }

    port.onMessage.addListener(async (message) => {
        if (message.type === PORT_MSG.START_STREAM) {
            await handleStartStream(port, message.payload as StartStreamPayload);
        }
    });

    port.onDisconnect.addListener(() => { });
});

async function handleStartStream(port: chrome.runtime.Port, payload: StartStreamPayload) {
    const { recordingId } = payload;

    const cached = pendingHandoffs.get(recordingId);
    if (!cached) {
        port.postMessage({
            type: PORT_MSG.STREAM_ERROR,
            payload: { error: 'Recording not found in cache. Request metadata first.' },
        });
        return;
    }

    const { screenBlob, cameraBlob, micBlob } = cached;

    try {
        await streamBlobChunks(port, screenBlob, 'screen');

        if (cameraBlob) {
            await streamBlobChunks(port, cameraBlob, 'camera');
        }

        if (micBlob) {
            await streamBlobChunks(port, micBlob, 'mic');
        }

        port.postMessage({
            type: PORT_MSG.STREAM_COMPLETE,
            payload: { recordingId },
        });

    } catch (error) {
        console.error('[Background] Stream error:', error);
        captureException(error instanceof Error ? error : new Error(String(error)));
        port.postMessage({
            type: PORT_MSG.STREAM_ERROR,
            payload: { error: error instanceof Error ? error.message : 'Unknown error' },
        });
    }
}

async function streamBlobChunks(
    port: chrome.runtime.Port,
    blob: Blob,
    source: 'screen' | 'camera' | 'mic'
) {
    const totalChunks = Math.ceil(blob.size / CHUNK_SIZE);

    for (let i = 0; i < totalChunks; i++) {
        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, blob.size);
        const chunk = blob.slice(start, end);

        const buffer = await chunk.arrayBuffer();
        const data = Array.from(new Uint8Array(buffer));

        const chunkPayload: ChunkPayload = {
            source,
            index: i,
            total: totalChunks,
            data,
        };

        port.postMessage({
            type: PORT_MSG.CHUNK,
            payload: chunkPayload,
        });
    }
}

async function handleHandoffComplete(payload: HandoffCompletePayload) {
    const { recordingId } = payload;

    pendingHandoffs.delete(recordingId);

    try {
        await ProjectStorage.deleteRawRecording(recordingId);
    } catch (error) {
        console.error('[Background] Failed to delete recording:', error);
        captureException(error instanceof Error ? error : new Error(String(error)));
    }
}
