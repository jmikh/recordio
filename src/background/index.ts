
import { type Size, EventType } from '../core/types';
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
            const response = await sendMessage('offscreen', MSG_TYPES.PING_OFFSCREEN, {}, { sessionId: 'init' });
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

function shouldLogMessage(type: string): boolean {
    if (type === MSG_TYPES.CAPTURE_USER_EVENT) return false;
    if (type === MSG_TYPES.PING_OFFSCREEN) return false;
    // Legacy event types match EventType enum values in lowercase or mixed
    const eventTypes = Object.values(EventType).map(t => t.toLowerCase());
    if (eventTypes.includes(type.toLowerCase())) return false;
    return true;
}

// Unified Helper: Send message
async function sendMessage(target: 'offscreen' | 'content', type: string, payload: any = {}, options?: { sessionId?: string, specificTabId?: number }) {
    const finalMessage: BaseMessage = {
        type,
        source: 'background',
        target,
        sessionId: options?.sessionId || currentState?.currentSessionId || 'unknown',
        timestamp: Date.now(),
        payload
    };

    if (shouldLogMessage(finalMessage.type)) {
        const destination = target === 'content'
            ? `Content (Tab: ${options?.specificTabId ? options.specificTabId : 'Broadcast'})`
            : 'Offscreen';
        logger.log(`[Background] SENT to ${destination}:`, finalMessage);
    }

    if (target === 'offscreen') {
        return chrome.runtime.sendMessage(finalMessage);
    } else {
        // Content logic
        if (options?.specificTabId) {
            await chrome.tabs.sendMessage(options.specificTabId, finalMessage).catch(() => { });
        } else if (currentState?.recordingTabId) {
            await chrome.tabs.sendMessage(currentState.recordingTabId, finalMessage).catch(() => { });
        } else {
            const tabs = await chrome.tabs.query({});
            for (const tab of tabs) {
                if (tab.id && tab.url && !tab.url.startsWith("chrome://") && !tab.url.startsWith("edge://") && !tab.url.startsWith("about:")) {
                    chrome.tabs.sendMessage(tab.id, finalMessage).catch(() => { });
                }
            }
        }
    }
}

// --- Message Handlers ---

async function handleStartRecording(message: any, sendResponse: Function) {
    try {
        const { tabId } = message;

        // 1. Setup Offscreen
        await setupOffscreenDocument('src/offscreen/offscreen.html');

        // 2. Get Media Stream ID (Tab Mode Only)
        let streamId = message.streamId; // if provided
        if (!streamId && tabId) {
            streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
        }
        if (!streamId) throw new Error("Failed to get stream ID");

        // 3. Wait for Offscreen
        await waitForOffscreen();

        // 4. Get Dimensions
        let dimensions: Size | null = null;
        try {
            const result = await chrome.scripting.executeScript({
                target: { tabId },
                func: () => ({
                    width: window.innerWidth,
                    height: window.innerHeight,
                    dpr: window.devicePixelRatio
                })
            });
            if (result?.[0]?.result) {
                const { width, height, dpr } = result[0].result;
                dimensions = { width: Math.round(width * dpr), height: Math.round(height * dpr) };
            }
        } catch (e) {
            logger.warn("Failed to get dims via script injection", e);
        }

        if (!dimensions) throw new Error("Could not retrieve tab dimensions.");

        // 5. Generate Session & Config
        const sessionId = crypto.randomUUID();
        const config: RecordingConfig = {
            hasAudio: message.hasAudio !== false,
            hasCamera: message.hasCamera === true,
            streamId: streamId,
            tabViewportSize: dimensions,
            audioDeviceId: message.audioDeviceId,
            videoDeviceId: message.videoDeviceId
        };

        // --- NEW FLOW: Prepare -> Countdown -> Start ---

        // A. Send PREPARE to Content (starts Countdown)
        // If tabId is provided (Tab Mode), we send to it specifically via helper logic or explicit arg.
        // The original code checked `if (tabId)`, which implies we only do this in Tab Mode or if we know the tab.
        if (tabId) {
            // Use helper with explicit tabId
            await sendMessage('content', MSG_TYPES.PREPARE_RECORDING, {}, { sessionId, specificTabId: tabId });

            // Wait for RECORDING_READY from Content
            await new Promise<void>((resolve, reject) => {
                const readyListener = (msg: any) => {
                    if (msg.type === MSG_TYPES.RECORDING_READY) {
                        chrome.runtime.onMessage.removeListener(readyListener);
                        resolve();
                    }
                };
                chrome.runtime.onMessage.addListener(readyListener);
                setTimeout(() => {
                    chrome.runtime.onMessage.removeListener(readyListener);
                    reject(new Error("Timeout waiting for countdown"));
                }, 5000);
            });
        }


        // B. Send START to Offscreen (VideoRecorder)
        const preparePromise = new Promise<void>((resolve, reject) => {
            const listener = (msg: any) => {
                if (msg.type === MSG_TYPES.RECORDING_STARTED) {
                    chrome.runtime.onMessage.removeListener(listener);
                    resolve();
                } else if (msg.type === MSG_TYPES.ERROR_OCCURRED) {
                    chrome.runtime.onMessage.removeListener(listener);
                    reject(new Error(msg.payload?.error || msg.error || "Recording failed to start"));
                }
            };
            chrome.runtime.onMessage.addListener(listener);
            setTimeout(() => {
                chrome.runtime.onMessage.removeListener(listener);
                reject(new Error("Timeout waiting for recording to start"));
            }, 5000);
        });

        await sendMessage('offscreen', MSG_TYPES.START_RECORDING, { config, mode: 'tab' }, { sessionId });
        await preparePromise;

        // C. Send START to Content (Start Event Capture)
        const syncTimestamp = Date.now();
        // Send to content (Target specific tab if tabId exists)
        await sendMessage('content', MSG_TYPES.START_RECORDING, { startTime: syncTimestamp }, { sessionId, specificTabId: tabId });


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

async function handleStopRecording(sendResponse: Function) {
    // No need to process events here, they are in Offscreen.

    logger.log("[Background] Sending STOP_RECORDING");

    if (currentState?.currentSessionId) {
        // Stop Offscreen (Video)
        sendMessage('offscreen', MSG_TYPES.STOP_RECORDING, {}, { sessionId: currentState.currentSessionId });

        // Stop Content (Events)
        // If we are in tab mode, state.recordingTabId is set, helper will use it.
        // If desktop mode, it will broadcast.
        await sendMessage('content', MSG_TYPES.STOP_RECORDING, {}, { sessionId: currentState.currentSessionId });
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
    if (message.target !== 'background') return false;

    if (shouldLogMessage(message.type)) {
        logger.log(`[Background] RECEIVED from ${(_sender.tab ? `Tab ${_sender.tab.id}` : _sender.id)}:`, message);
    }

    // Ensure state is loaded
    (async () => {
        await ensureState();
        if (!currentState) return; // Should be set by ensureState

        // 1. Event Capture (Moved inside promise to ensure currentState is valid)
        let eventPayload = null;
        if (message.type === MSG_TYPES.CAPTURE_USER_EVENT) {
            eventPayload = message.payload;
        } else if (Object.values(EventType).includes(message.type.toLowerCase() as any)) {
            // Legacy fallback
            eventPayload = { ...message.payload, type: message.type.toLowerCase() };
        }

        if (eventPayload && _sender.tab) {
            // Strict Validation: Must be from recording tab
            if (currentState.isRecording && _sender.tab.id === currentState.recordingTabId) {
                // Forward to Offscreen
                sendMessage('offscreen', MSG_TYPES.CAPTURE_USER_EVENT, eventPayload);
            } else {
                // Safety Disconnect: If a tab sends events but shouldn't be recording
                const senderTabId = _sender.tab.id;
                if (senderTabId !== undefined) {
                    // We might see some stray events on restart if content script is still active but state says not recording.
                    // Only warn if we are explicitly strictly recording a DIFFERENT tab, or if we want strict silence.
                    // reliable state is key.
                    if (currentState.isRecording) {
                        console.warn(`[Background] Unauthorized event from Tab ${senderTabId} (Recording Tab: ${currentState.recordingTabId}). Ignoring.`);
                    }
                }
            }
            return; // We handled it
        }

        // 2. Command Routing
        switch (message.type) {
            case MSG_TYPES.START_RECORDING:
                handleStartRecording(message, sendResponse);
                break; // Async response

            case MSG_TYPES.STOP_RECORDING:
                handleStopRecording(sendResponse);
                break; // Async response

            case MSG_TYPES.GET_RECORDING_STATE:
                handleGetRecordingState(_sender, sendResponse);
                break;

            case MSG_TYPES.RECORDING_STOPPED:
                // Use sessionId from message payload as state is already cleared
                const finalSessionId = message.sessionId;
                const editorUrl = chrome.runtime.getURL('src/editor/index.html') + `?projectId=${finalSessionId || ''}`;
                chrome.tabs.create({ url: editorUrl });
                chrome.offscreen.closeDocument().catch(() => { });
                break;

            case MSG_TYPES.PING_OFFSCREEN:
                sendResponse("PONG");
                break;
        }
    })();
    return true; // We always return true because of the async wrapper
});
