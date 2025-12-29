
import { type Size } from '../core/types';
import { logger } from '../utils/logger';
import { MSG_TYPES, type BaseMessage, type RecordingConfig, type RecordingState, STORAGE_KEYS } from '../shared/messageTypes';

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

// --- Content Script Injection ---

import contentScriptPath from '../content/index.ts?script';

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
        const { tabId, streamId: providedStreamId, hasAudio, hasCamera, audioDeviceId, videoDeviceId } = message.payload || {};

        // 1. Setup Offscreen
        await setupOffscreenDocument('src/offscreen/offscreen.html');

        // 2. Get Media Stream ID (Tab Mode Only)
        let streamId = providedStreamId; // if provided
        if (!streamId && tabId) {
            streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
        }
        if (!streamId) throw new Error("Failed to get stream ID");

        // 3. Wait for Offscreen
        await waitForOffscreen();

        const sessionId = crypto.randomUUID();

        // --- NEW FLOW: Prepare -> Countdown -> Start ---

        // A. Send PREPARE to Content (starts Countdown)
        if (tabId) {
            const countdownMsg: BaseMessage = {
                type: MSG_TYPES.START_COUNTDOWN,
                payload: { sessionId }
            };
            chrome.tabs.sendMessage(tabId, countdownMsg)
        }

        // Wait for COUNTDOWN_DONE from Content (contains dimensions)
        let dimensions: Size | null = null;
        if (tabId) {
            dimensions = await new Promise<Size | null>((resolve, reject) => {
                const readyListener = (msg: any) => {
                    if (msg.type === MSG_TYPES.COUNTDOWN_DONE && msg.payload?.sessionId === sessionId) {
                        chrome.runtime.onMessage.removeListener(readyListener);
                        // Extract dims
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

        if (!dimensions) throw new Error("Could not retrieve viewport dimensions from content script.");

        // 5. Generate Config (Now we have dimensions)

        const config: RecordingConfig = {
            hasAudio: hasAudio !== false,
            hasCamera: hasCamera === true,
            streamId: streamId,
            tabViewportSize: dimensions,
            audioDeviceId: audioDeviceId,
            videoDeviceId: videoDeviceId
        };


        // B. Send START to Offscreen (VideoRecorder)
        const startVideoMsg: BaseMessage = {
            type: MSG_TYPES.START_RECORDING_VIDEO,
            payload: { config, mode: 'tab', sessionId }
        };
        await chrome.runtime.sendMessage(startVideoMsg);

        // C. Send START to Content (Start Event Capture)
        const syncTimestamp = Date.now();
        // Send to content (Target specific tab if tabId exists)
        if (tabId) {
            const startEventsMsg: BaseMessage = {
                type: MSG_TYPES.START_RECORDING_EVENTS,
                payload: { startTime: syncTimestamp, sessionId }
            };
            chrome.tabs.sendMessage(tabId, startEventsMsg)
        }


        // 8. Update State & Persist
        await saveState({
            isRecording: true,
            recordingTabId: tabId,
            startTime: syncTimestamp,
            currentSessionId: sessionId,
            mode: 'tab' // or infer
        });

        // Clear previous legacy timestamps if any
        chrome.storage.local.set({ recordingSyncTimestamp: syncTimestamp });
        sendResponse({ success: true });

    } catch (err: any) {
        logger.error("Error starting recording:", err);
        sendResponse({ success: false, error: err.message });
    }
}

async function handleStopSession(sendResponse: Function) {
    // No need to process events here, they are in Offscreen.

    logger.log("[Background] Sending STOP_RECORDING");

    const finalSessionId = currentState?.currentSessionId;

    if (finalSessionId) {
        try {
            // Stop Offscreen (Video)
            // Wait for response which contains success/duration
            const stopVideoMsg: BaseMessage = {
                type: MSG_TYPES.STOP_RECORDING_VIDEO,
                payload: { sessionId: finalSessionId }
            };
            const response = await chrome.runtime.sendMessage(stopVideoMsg);
            logger.log("[Background] Offscreen stop response:", response);

            // Stop Content (Events)
            if (currentState?.recordingTabId) {
                const stopEventsMsg: BaseMessage = {
                    type: MSG_TYPES.STOP_RECORDING_EVENTS,
                    payload: { sessionId: finalSessionId }
                };
                await chrome.tabs.sendMessage(currentState.recordingTabId, stopEventsMsg).catch(() => { });
            }

            // Handle Editor Opening logic here now
            const editorUrl = chrome.runtime.getURL('src/editor/index.html') + `?projectId=${finalSessionId || ''}`;
            chrome.tabs.create({ url: editorUrl });
            chrome.offscreen.closeDocument().catch(() => { });

        } catch (e) {
            logger.error("Error stopping recording orchestration:", e);
        }
    }

    await saveState({
        isRecording: false,
        recordingTabId: null,
        currentSessionId: null
    });
    chrome.storage.local.remove(['recordingSyncTimestamp']);

    sendResponse({ success: true });
}

function handleGetRecordingState(_sender: chrome.runtime.MessageSender, sendResponse: Function) {
    // Ensure we send back the current state
    if (!currentState) return sendResponse({ isRecording: false, startTime: 0 }); // Trigger fallback if ensureState failed

    let isRecording = currentState.isRecording;
    if (_sender.tab?.id) {
        // Only report recording=true if we are recording THIS tab
        isRecording = currentState.isRecording && _sender.tab.id === currentState.recordingTabId;
    }
    sendResponse({ isRecording, startTime: currentState.startTime });
}

// --- Main Listener ---

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    // Strict Filter: Only handle messages intended for background
    // Removed target check as it is part of the refactor


    logger.log(`[Background] RECEIVED from ${(_sender.tab ? `Tab ${_sender.tab.id}` : _sender.id)}:`, message);

    // Ensure state is loaded
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
                // sendResponse("PONG");
                break;
        }
    })();
    return true; // We always return true because of the async wrapper
});
