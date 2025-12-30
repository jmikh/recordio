/**
 * @fileoverview Background Service Worker
 * 
 * Orchestrates recording sessions for the Recordo extension.
 * - Routes messages between popup, content scripts, offscreen doc, and controller
 * - Manages session state (start/stop recording, mode selection)
 * - Handles tab capture (tab mode) and desktop capture picker (window/desktop mode)
 * - Persists state to chrome.storage.session for service worker restarts
 */

import { type Size } from '../core/types';
import { logger } from '../utils/logger';
import { MSG_TYPES, type BaseMessage, type RecordingConfig, type RecordingState, STORAGE_KEYS } from './shared/messageTypes';

logger.log("Background service worker running");

// --- State Management ---

// Default state if storage is empty
const DEFAULT_STATE: RecordingState = {
    isRecording: false,
    recordingTabId: null,
    recorderEnvironmentId: null,
    startTime: 0,
    currentSessionId: null,
    mode: null
};

let currentState: RecordingState | null = null;

async function ensureState() {
    if (currentState) return; // Already loaded

    try {
        const result = await chrome.storage.session.get(STORAGE_KEYS.RECORDING_STATE);
        if (result[STORAGE_KEYS.RECORDING_STATE]) {
            currentState = result[STORAGE_KEYS.RECORDING_STATE] as RecordingState;
            logger.log("State restored from storage:", currentState);
        } else {
            currentState = { ...DEFAULT_STATE };
            logger.log("No stored state found, using defaults.");
        }
    } catch (e) {
        logger.error("Failed to restore state:", e);
        // Fallback to defaults on error to allow extension to function
        currentState = { ...DEFAULT_STATE };
    }
}

async function saveState(newState: Partial<RecordingState>) {
    // Ensure we have a base state before merging (should be covered by ensureState usage)
    if (!currentState) currentState = { ...DEFAULT_STATE };

    currentState = { ...currentState, ...newState };
    await chrome.storage.session.set({ [STORAGE_KEYS.RECORDING_STATE]: currentState });
}

// --- Offscreen Setup ---

async function setupOffscreenDocument(path: string) {
    const existingContexts = await chrome.runtime.getContexts({
        contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    });

    if (existingContexts.length > 0) {
        try {
            await chrome.offscreen.closeDocument();
        } catch (e) {
            console.log("[Background] Failed to close existing offscreen doc (might be already gone)", e);
        }
    }

    try {
        await chrome.offscreen.createDocument({
            url: path,
            reasons: [chrome.offscreen.Reason.USER_MEDIA],
            justification: 'Recording screen',
        });
    } catch (e: any) {
        if (!e.message.includes('Only one offscreen document may be created')) {
            throw e;
        }
    }
}

async function waitForOffscreen() {
    for (let i = 0; i < 20; i++) { // Try for 2 seconds
        try {
            const response = await chrome.runtime.sendMessage({
                type: MSG_TYPES.PING_OFFSCREEN,
                payload: { sessionId: 'init' }
            });
            if (response === 'PONG') return;
        } catch (e) {
            // Context not ready
        }
        await new Promise(r => setTimeout(r, 100));
    }
    throw new Error("Offscreen document failed to initialize");
}

// --- Controller Tab Setup (Window/Desktop Mode) ---

let controllerTabId: number | null = null;

async function closeControllerTab() {
    if (controllerTabId) {
        try {
            await chrome.tabs.remove(controllerTabId);
        } catch (e) {
            logger.log("[Background] Failed to close controller tab (might be already gone)");
        }
        controllerTabId = null;
    }
}

async function openControllerTab(): Promise<number> {
    await closeControllerTab();

    const tab = await chrome.tabs.create({
        url: chrome.runtime.getURL('src/recording/controller.html'),
        active: true,
        pinned: true
    });

    if (!tab || !tab.id) throw new Error("Failed to create controller tab");
    controllerTabId = tab.id;

    // Wait for tab to fully load (chooseDesktopMedia requires a valid URL)
    await new Promise<void>((resolve) => {
        const listener = (tabId: number, info: any) => {
            if (tabId === tab.id && info.status === 'complete') {
                chrome.tabs.onUpdated.removeListener(listener);
                resolve();
            }
        };
        chrome.tabs.onUpdated.addListener(listener);
        // Timeout fallback
        setTimeout(() => {
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
        }, 3000);
    });

    return tab.id;
}

async function waitForController() {
    for (let i = 0; i < 30; i++) { // Try for 3 seconds
        try {
            const response = await chrome.runtime.sendMessage({
                type: MSG_TYPES.PING_CONTROLLER,
                payload: {}
            });
            if (response === 'PONG') return;
        } catch (e) {
            // Context not ready
        }
        await new Promise(r => setTimeout(r, 100));
    }
    throw new Error("Controller tab failed to initialize");
}

// --- Content Script Injection ---

import contentScriptPath from './content.ts?script';

chrome.runtime.onInstalled.addListener(async () => {
    console.log("[Background] Extension Installed/Updated. Injecting content scripts...");
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
        if (tab.id && tab.url && !tab.url.startsWith("chrome://") && !tab.url.startsWith("edge://") && !tab.url.startsWith("about:")) {
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

// --- Event Helpers ---


// --- Message Sending Helper ---
// Helper removed, using direct calls.


// --- Message Handlers ---

// --- Message Handlers ---

async function handleStartSession(message: any, sendResponse: Function) {
    try {
        const { mode = 'tab' } = message.payload || {};
        const sessionId = crypto.randomUUID();

        if (mode === 'tab') {
            await startTabModeSession(message.payload, sessionId);
        } else {
            await startControllerModeSession(message.payload, sessionId, mode);
        }

        sendResponse({ success: true });
    } catch (err: any) {
        logger.error("Error starting recording:", err);
        sendResponse({ success: false, error: err.message });
    }
}

async function startTabModeSession(payload: any, sessionId: string) {
    const { tabId, hasAudio, hasCamera, audioDeviceId, videoDeviceId } = payload || {};

    if (!tabId) throw new Error("Tab ID is required for tab recording");

    // 1. Setup Offscreen
    await setupOffscreenDocument('src/recording/offscreen.html');

    // 2. Get Media Stream ID
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
    if (!streamId) throw new Error("Failed to get stream ID");

    // 3. Wait for Offscreen
    await waitForOffscreen();

    // 4. Start Countdown and get dimensions
    if (tabId) {
        const countdownMsg: BaseMessage = {
            type: MSG_TYPES.START_COUNTDOWN,
            payload: { sessionId }
        };
        chrome.tabs.sendMessage(tabId, countdownMsg);
    }

    // Wait for COUNTDOWN_DONE from Content (contains dimensions)
    const dimensions = await waitForCountdownDone(tabId, sessionId);
    if (!dimensions) throw new Error("Could not retrieve viewport dimensions from content script.");

    // 5. Generate Config
    const config: RecordingConfig = {
        hasAudio: hasAudio !== false,
        hasCamera: hasCamera === true,
        streamId: streamId,
        tabViewportSize: dimensions,
        audioDeviceId: audioDeviceId,
        videoDeviceId: videoDeviceId
    };

    // 6. Send START to Offscreen (VideoRecorder)
    const startVideoMsg: BaseMessage = {
        type: MSG_TYPES.START_RECORDING_VIDEO,
        payload: { config, mode: 'tab', sessionId }
    };
    await chrome.runtime.sendMessage(startVideoMsg);

    // 7. Send START to Content (Start Event Capture)
    const syncTimestamp = Date.now();
    if (tabId) {
        const startEventsMsg: BaseMessage = {
            type: MSG_TYPES.START_RECORDING_EVENTS,
            payload: { startTime: syncTimestamp, sessionId }
        };
        chrome.tabs.sendMessage(tabId, startEventsMsg);
    }

    // 8. Update State
    await saveState({
        isRecording: true,
        recordingTabId: tabId,
        recorderEnvironmentId: null,
        startTime: syncTimestamp,
        currentSessionId: sessionId,
        mode: 'tab'
    });

    chrome.storage.local.set({ recordingSyncTimestamp: syncTimestamp });
}

async function startControllerModeSession(payload: any, sessionId: string, mode: 'window' | 'desktop') {
    const { hasAudio, hasCamera, audioDeviceId, videoDeviceId } = payload || {};

    // 1. Open Controller Tab first (needed as target for chooseDesktopMedia in service worker)
    const controllerTabId = await openControllerTab();

    // Get the tab object for chooseDesktopMedia
    const controllerTab = await chrome.tabs.get(controllerTabId);

    // 2. Show desktop capture picker (needs target tab when called from service worker)
    const sources = mode === 'window'
        ? ['window' as const]
        : ['screen' as const, 'window' as const];

    const sourceId = await new Promise<string>((resolve, reject) => {
        chrome.desktopCapture.chooseDesktopMedia(sources, controllerTab, (streamId) => {
            if (streamId) {
                resolve(streamId);
            } else {
                reject(new Error("User cancelled desktop capture picker"));
            }
        });
    });

    // 3. Wait for Controller to be ready
    await waitForController();

    // 4. Generate Config with sourceId
    const config: RecordingConfig = {
        hasAudio: hasAudio !== false,
        hasCamera: hasCamera === true,
        audioDeviceId: audioDeviceId,
        videoDeviceId: videoDeviceId,
        sourceId: sourceId
    };

    // 5. Send START to Controller
    const syncTimestamp = Date.now();
    const startVideoMsg: BaseMessage = {
        type: MSG_TYPES.START_RECORDING_VIDEO,
        payload: { config, mode, sessionId }
    };
    const controllerResponse = await chrome.runtime.sendMessage(startVideoMsg);

    // Check Window Detection
    if (controllerResponse && controllerResponse.detection && !controllerResponse.detection.isValid) {
        logger.warn("[Background]");
        // We still record the video (it will just be the wrong window), but we won't record user events.
        // Or should we abort entirely?
        // User just said "don't capture events". So we skip step 6.

        // 7. Update State (Event recording skipped)
        await saveState({
            isRecording: true,
            recordingTabId: null,
            recorderEnvironmentId: controllerTabId,
            startTime: syncTimestamp,
            currentSessionId: sessionId,
            mode: mode
        });

        chrome.storage.local.set({ recordingSyncTimestamp: syncTimestamp });
        return;
    }

    // 6. Broadcast START_RECORDING_EVENTS to all tabs
    // syncTimestamp defined above
    const startEventsMsg: BaseMessage = {
        type: MSG_TYPES.START_RECORDING_EVENTS,
        payload: { startTime: syncTimestamp, sessionId }
    };

    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
        if (tab.id) {
            // Send and forget - some tabs might be restricted (chrome:// etc)
            chrome.tabs.sendMessage(tab.id, startEventsMsg).catch(() => { });
        }
    }

    // 7. Update State
    await saveState({
        isRecording: true,
        recordingTabId: null,
        recorderEnvironmentId: controllerTabId,
        startTime: syncTimestamp,
        currentSessionId: sessionId,
        mode: mode
    });

    chrome.storage.local.set({ recordingSyncTimestamp: syncTimestamp });
}

async function waitForCountdownDone(tabId: number | undefined, sessionId: string): Promise<Size | null> {
    if (!tabId) return null;

    return new Promise<Size | null>((resolve, reject) => {
        const readyListener = (msg: any) => {
            if (msg.type === MSG_TYPES.COUNTDOWN_DONE && msg.payload?.sessionId === sessionId) {
                chrome.runtime.onMessage.removeListener(readyListener);
                if (msg.payload && msg.payload.width && msg.payload.height) {
                    const { width, height, dpr } = msg.payload;
                    resolve({ width: Math.round(width * (dpr || 1)), height: Math.round(height * (dpr || 1)) });
                } else {
                    resolve(null);
                }
            }
        };
        chrome.runtime.onMessage.addListener(readyListener);
        setTimeout(() => {
            chrome.runtime.onMessage.removeListener(readyListener);
            reject(new Error("Timeout waiting for countdown"));
        }, 5000);
    });
}

async function handleStopSession(sendResponse: Function) {
    logger.log("[Background] Sending STOP_RECORDING");

    const finalSessionId = currentState?.currentSessionId;

    if (finalSessionId) {
        try {
            // Send STOP to the appropriate recorder (offscreen or controller)
            const stopVideoMsg: BaseMessage = {
                type: MSG_TYPES.STOP_RECORDING_VIDEO,
                payload: { sessionId: finalSessionId }
            };
            const response = await chrome.runtime.sendMessage(stopVideoMsg);
            logger.log("[Background] Recorder stop response:", response);


        } catch (e) {
            logger.error("Failed to stop video recording: ", e);
        }

        // Open editor
        const editorUrl = chrome.runtime.getURL('src/editor/index.html') + `?projectId=${finalSessionId || ''}`;
        chrome.tabs.create({ url: editorUrl });
    }
    // Cleanup regardless of success

    chrome.offscreen.closeDocument()
    closeControllerTab();

    const stopEventsMsg: BaseMessage = {
        type: MSG_TYPES.STOP_RECORDING_EVENTS,
        payload: { sessionId: finalSessionId }
    };

    // broadcast to all tabs safer.
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
        if (tab.id) {
            chrome.tabs.sendMessage(tab.id, stopEventsMsg)
        }
    }

    await saveState({
        isRecording: false,
        recordingTabId: null,
        recorderEnvironmentId: null,
        currentSessionId: null,
        mode: null
    });
    chrome.storage.local.remove(['recordingSyncTimestamp']);

    sendResponse({ success: true });
}

function handleGetRecordingState(_sender: chrome.runtime.MessageSender, sendResponse: Function) {
    // Ensure we send back the current state
    if (!currentState) return sendResponse({ isRecording: false, startTime: 0 }); // Trigger fallback if ensureState failed

    let isRecording = currentState.isRecording;
    if (_sender.tab?.id && currentState.mode === 'tab') {
        // Only report recording=true if we are recording THIS tab
        isRecording = currentState.isRecording && _sender.tab.id === currentState.recordingTabId;
    }
    sendResponse({ isRecording, startTime: currentState.startTime });
}

// --- Main Listener ---

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    (async () => {
        await ensureState();
        if (!currentState) return; // Should be set by ensureState


        // 2. Command Routing
        switch (message.type) {
            case MSG_TYPES.START_SESSION:
                handleStartSession(message, sendResponse);
                break; // Async response

            case MSG_TYPES.STOP_SESSION:
                handleStopSession(sendResponse);
                break; // Async response

            case MSG_TYPES.GET_RECORDING_STATE:
                handleGetRecordingState(_sender, sendResponse);
                break;

            case MSG_TYPES.PING_OFFSCREEN:
                sendResponse("PONG");
                break;
        }
    })();
    return true; // We always return true because of the async wrapper
});
