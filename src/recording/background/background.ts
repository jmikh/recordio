/**
 * @fileoverview Background Service Worker
 * 
 * Orchestrates recording sessions for the Recordio extension.
 * - Routes messages between popup, content scripts, offscreen doc, and controller
 * - Manages session state (start/stop recording, mode selection)
 * - Handles tab capture (tab mode) and desktop capture picker (window/desktop mode)
 * - Persists state to chrome.storage.session for service worker restarts
 */

import { type Size } from '../../core/types';
import { initSentry } from '../../utils/sentry';
import { trackRecordingCompleted } from '../../core/analytics';
import { MSG_TYPES, type BaseMessage, type RecordingConfig, type RecordingState, STORAGE_KEYS } from '../shared/messageTypes';

// Initialize Sentry for error tracking
initSentry('background');

// --- State Management ---

// Default state if storage is empty
const DEFAULT_STATE: RecordingState = {
    isRecording: false,
    recordedTabId: null,
    controllerTabId: null,
    startTime: 0,
    currentSessionId: null,
    mode: null,
    originalTabId: null
};

let currentState: RecordingState | null = null;
// Singleton promise to track initialization
let stateReady: Promise<void> | null = null;

async function doEnsureState() {
    try {
        const result = await chrome.storage.session.get(STORAGE_KEYS.RECORDING_STATE);
        if (result[STORAGE_KEYS.RECORDING_STATE]) {
            currentState = result[STORAGE_KEYS.RECORDING_STATE] as RecordingState;
            console.log("State restored from storage:", currentState);
        } else {
            currentState = { ...DEFAULT_STATE };
            console.log("No stored state found, using defaults.");
        }
    } catch (e) {
        console.error("Failed to restore state:", e);
        // Fallback to defaults on error to allow extension to function
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

async function closeControllerTab(tabId: number | null) {
    if (tabId) {
        chrome.tabs.remove(tabId).catch(() => { });
    }
}

async function openControllerTab(): Promise<number> {
    const tab = await chrome.tabs.create({
        url: chrome.runtime.getURL('src/recording/controller/controller.html'),
        active: true,
        pinned: true
    });

    if (!tab || !tab.id) throw new Error("Failed to create controller tab");

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

// --- Content Script Injection ---

import contentScriptPath from '../content/content.ts?script';

chrome.runtime.onInstalled.addListener(async () => {
    console.log("[Background] Extension Installed/Updated. Injecting content scripts...");
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
            // popup now sends tabId in payload as active tab when it was opened
            await startControllerModeSession(message.payload, sessionId, mode);
        }

        sendResponse({ success: true });
    } catch (err: any) {
        console.error("Error starting recording:", err);
        sendResponse({ success: false, error: err.message });
    }
}

async function startTabModeSession(payload: any, sessionId: string) {
    const { tabId, hasAudio, hasCamera, audioDeviceId, videoDeviceId } = payload || {};

    if (!tabId) throw new Error("Tab ID is required for tab recording");

    // 1. Setup Offscreen
    await setupOffscreenDocument('src/recording/offscreen/offscreen.html');

    // 2. Get Media Stream ID
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
    if (!streamId) throw new Error("Failed to get stream ID");

    // 3. Wait for Offscreen
    await waitForOffscreen();

    // 5. Generate Config
    const tabInfo = await chrome.tabs.get(tabId);

    // Fetch REAL dimensions from content script now
    // This ensures MediaStreams are initialized with correct constraints
    if (!tabId) throw new Error("No tab ID");

    // Simple await-based fetch. This will throw if content script is gone.
    const initialDimensions: any = await chrome.tabs.sendMessage(tabId, { type: MSG_TYPES.GET_VIEWPORT_SIZE });

    if (!initialDimensions) {
        throw new Error("Failed to get viewport size: No response");
    }

    const config: RecordingConfig = {
        hasAudio: hasAudio !== false,
        hasCamera: hasCamera === true,
        streamId: streamId,
        tabViewportSize: {
            width: Math.round(initialDimensions.width * (initialDimensions.dpr || 1)),
            height: Math.round(initialDimensions.height * (initialDimensions.dpr || 1))
        },


        audioDeviceId: audioDeviceId,
        videoDeviceId: videoDeviceId,
        sourceName: tabInfo?.title || 'Tab'
    };

    // 6. Send PREPARE to Offscreen (Warmup Streams)
    // This starts the camera while we do the countdown
    const prepareVideoMsg: BaseMessage = {
        type: MSG_TYPES.PREPARE_RECORDING_VIDEO,
        payload: { config, mode: 'tab', sessionId }
    };
    await chrome.runtime.sendMessage(prepareVideoMsg);

    // 7. Start Countdown and get dimensions
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

    // Update config with real dimensions
    config.tabViewportSize = dimensions;

    // 6. Send START to Offscreen (VideoRecorder)
    const startVideoMsg: BaseMessage = {
        type: MSG_TYPES.START_RECORDING_VIDEO,
        payload: { config, mode: 'tab', sessionId }
    };
    // ensures enough time the timer overlay to disappear
    await new Promise(resolve => setTimeout(resolve, 100));
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
        recordedTabId: tabId,
        controllerTabId: null,
        startTime: syncTimestamp,
        currentSessionId: sessionId,
        mode: 'tab',
        originalTabId: tabId
    });

    chrome.storage.local.set({ recordingSyncTimestamp: syncTimestamp });
}

async function startControllerModeSession(payload: any, sessionId: string, mode: 'window' | 'screen') {
    let openedControllerTabId: number | null = null;
    const { hasAudio, hasCamera, audioDeviceId, videoDeviceId, tabId: originalTabId } = payload || {};

    try {
        // 1. Open Controller Tab first (needed as target for chooseDesktopMedia in service worker)
        openedControllerTabId = await openControllerTab();

        // Get the tab object for chooseDesktopMedia
        const controllerTab = await chrome.tabs.get(openedControllerTabId);

        // 2. Show desktop capture picker (needs target tab when called from service worker)
        const sources = mode === 'window'
            ? ['window' as const]
            : ['screen' as const];

        const sourceId = await new Promise<string>((resolve, reject) => {
            chrome.desktopCapture.chooseDesktopMedia(sources, controllerTab, (streamId) => {
                if (streamId) {
                    resolve(streamId);
                } else {
                    reject(new Error("User cancelled desktop capture picker"));
                }
            });
        });

        // 4. Generate Config with sourceId
        const config: RecordingConfig = {
            hasAudio: hasAudio !== false,
            hasCamera: hasCamera === true,
            audioDeviceId: audioDeviceId,
            videoDeviceId: videoDeviceId,
            sourceId: sourceId,
            sourceName: mode === 'window' ? 'Window' : 'Desktop'
        };

        // 5. Send PREPARE to Controller
        const prepareVideoMsg: BaseMessage = {
            type: MSG_TYPES.PREPARE_RECORDING_VIDEO,
            payload: { config, mode, sessionId }
        };
        const prepareResponse = await chrome.tabs.sendMessage(openedControllerTabId, prepareVideoMsg);

        // 6. Switch back to original tab if available (Before Start)
        if (originalTabId) {
            chrome.tabs.update(originalTabId, { active: true }).catch(() => { });

        }

        // 7. Send START to Controller
        const startVideoMsg: BaseMessage = {
            type: MSG_TYPES.START_RECORDING_VIDEO,
            payload: { config, mode, sessionId }
        };
        // ensures enough time for the tab switch to take effect and 
        // web cam to warm up
        await new Promise(resolve => setTimeout(resolve, 500));
        const syncTimestamp = Date.now();
        await chrome.tabs.sendMessage(openedControllerTabId, startVideoMsg);

        let recordEvents = true;
        // Check Window Detection (from PREPARE response)
        if (prepareResponse && prepareResponse.detection && !prepareResponse.detection.isControllerWindow) {
            recordEvents = false;
        }

        if (recordEvents) {
            // 7. Broadcast START_RECORDING_EVENTS to all tabs
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
        }

        // 7. Update State
        await saveState({
            isRecording: true,
            recordedTabId: null,
            controllerTabId: openedControllerTabId,
            startTime: syncTimestamp,
            currentSessionId: sessionId,
            mode: mode,
            originalTabId: originalTabId || null
        });

    } catch (error) {
        if (openedControllerTabId) {
            closeControllerTab(openedControllerTabId);
        }
        if (originalTabId) {
            chrome.tabs.update(originalTabId, { active: true }).catch(() => { });
        }
        throw error;
    }
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
    await ensureState(); // Ensure state is loaded
    console.log("[Background] Sending STOP_RECORDING");

    const finalSessionId = currentState?.currentSessionId;
    // Capture the controller ID from state before we wipe the state
    const controllerTabIdToClose = currentState?.controllerTabId;

    const stopEventsMsg: BaseMessage = {
        type: MSG_TYPES.STOP_RECORDING_EVENTS,
        payload: { sessionId: finalSessionId }
    };

    // broadcast to all tabs safer.
    // This should happen first to flush any pending events. (though we might still need a wait)
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
        if (tab.id) {
            chrome.tabs.sendMessage(tab.id, stopEventsMsg).catch(() => { /* ignore */ });
        }
    }

    if (finalSessionId) {
        try {
            // Send STOP to the appropriate recorder (offscreen or controller)
            const stopVideoMsg: BaseMessage = {
                type: MSG_TYPES.STOP_RECORDING_VIDEO,
                payload: { sessionId: finalSessionId }
            };

            let response;
            if (currentState?.mode === 'tab') {
                response = await chrome.runtime.sendMessage(stopVideoMsg);
            } else if ((currentState?.mode === 'window' || currentState?.mode === 'screen') && controllerTabIdToClose) {
                response = await chrome.tabs.sendMessage(controllerTabIdToClose, stopVideoMsg);
            }

            console.log("[Background] Recorder stop response:", response);

            // Track recording completion
            const recordingDurationSeconds = currentState?.startTime
                ? Math.floor((Date.now() - currentState.startTime) / 1000)
                : 0;

            // Get user state from storage for analytics
            const userStorage = await chrome.storage.local.get('recordio-user-storage') as { 'recordio-user-storage'?: { state?: { isAuthenticated?: boolean; isPro?: boolean } } };
            const userState = userStorage['recordio-user-storage']?.state || {};

            trackRecordingCompleted({
                mode: currentState?.mode || 'tab',
                duration_seconds: recordingDurationSeconds,
                is_authenticated: userState.isAuthenticated || false,
                is_pro: userState.isPro || false,
            });

            // Open editor
            const editorUrl = chrome.runtime.getURL('src/editor/index.html') + `?projectId=${finalSessionId || ''}`;
            chrome.tabs.create({ url: editorUrl });
        } catch (e) {
            console.error("Failed to stop video recording: ", e);
        }
    }
    // Cleanup regardless of success


    await saveState({
        isRecording: false,
        recordedTabId: null,
        controllerTabId: null,
        currentSessionId: null,
        mode: null,
        originalTabId: null
    });

    // remove those after saving state so they don't accidentally trigger another stop session
    // TODO: comment out to see logs upon exit
    chrome.offscreen.closeDocument().catch(() => { });

    // Close using the ID we captured earlier
    if (controllerTabIdToClose) {
        closeControllerTab(controllerTabIdToClose);
    }

    sendResponse({ success: true });
}

function handleGetRecordingState(_sender: chrome.runtime.MessageSender, sendResponse: Function) {
    // Ensure we send back the current state
    if (!currentState) return sendResponse({ isRecording: false, startTime: 0 }); // Trigger fallback if ensureState failed

    let isRecording = currentState.isRecording;
    if (_sender.tab?.id && currentState.mode === 'tab') {
        // Only report recording=true if we are recording THIS tab
        isRecording = currentState.isRecording && _sender.tab.id === currentState.recordedTabId;
    }
    sendResponse({ isRecording, startTime: currentState.startTime });
}

// --- Tab Removal Listener ---
// Detect if the recorded tab or controller tab is closed
chrome.tabs.onRemoved.addListener(async (tabId) => {
    await ensureState();
    if (!currentState || !currentState.isRecording) return;

    const isRecordedTab = currentState.mode === 'tab' && currentState.recordedTabId === tabId;
    const isControllerTab = (currentState.mode === 'window' || currentState.mode === 'screen') && currentState.controllerTabId === tabId;

    if (isRecordedTab || isControllerTab) {
        console.log(`[Background] Detected closure of ${isRecordedTab ? 'recorded tab' : 'controller tab'}. Stopping session.`);
        handleStopSession(() => { }); // No response needed
    }
});

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
