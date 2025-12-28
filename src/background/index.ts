
import { type Size, EventType, type UserEvents, type MouseClickEvent, type MousePositionEvent, type KeyboardEvent, type DragEvent, type TypingEvent, type UrlChangeEvent } from '../core/types';
import { logger } from '../utils/logger';
import { MSG } from '../shared/messages';

logger.log("Background service worker running");

interface BackgroundState {
    isRecording: boolean;
    recordingTabId: number | null;
    recordingWindowId: number | null;
    recordingMode: 'tab' | 'window';
    recorderEnvironmentId: number | null;
    startTime: number;
    events: any[];
    activeCalibrationDimensions: Size | null;
}

const state: BackgroundState = {
    isRecording: false,
    recordingTabId: null,
    recordingWindowId: null,
    recordingMode: 'tab',
    recorderEnvironmentId: null,
    startTime: 0,
    events: [],
    activeCalibrationDimensions: null
};


// Ensure offscreen document exists
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
    for (let i = 0; i < 20; i++) { // Try for 2 seconds (100ms * 20)
        try {
            const response = await chrome.runtime.sendMessage({ type: MSG.PING_OFFSCREEN });
            if (response === 'PONG') return;
        } catch (e) {
            // Context not ready
        }
        await new Promise(r => setTimeout(r, 100));
    }
    throw new Error("Offscreen document failed to initialize");
}

// On Install/Update: Inject content script into existing tabs
// Import the content script path via Vite's special ?script suffix logic
import contentScriptPath from '../content/index.ts?script';

// On Install/Update: Inject content script into existing tabs
chrome.runtime.onInstalled.addListener(async () => {
    console.log("[Background] Extension Installed/Updated. Injecting content scripts...");
    const tabs = await chrome.tabs.query({});
    console.log(`[Background] Found ${tabs.length} tabs to check.`, tabs);

    for (const tab of tabs) {
        if (tab.id && tab.url && !tab.url.startsWith("chrome://") && !tab.url.startsWith("edge://") && !tab.url.startsWith("about:")) {
            try {
                await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    files: [contentScriptPath]
                });
                console.log(`[Background] Injected into tab ${tab.id} (${tab.url})`);
            } catch (err: any) {
                console.warn(`[Background] Failed to inject into tab ${tab.id} (${tab.url})`, err.message);
            }
        }
    }
});

// Track Active Tab Changes for Window Recording
chrome.tabs.onActivated.addListener(async (activeInfo) => {
    if (state.isRecording && state.recordingMode === 'window' && state.recordingWindowId === activeInfo.windowId) {
        logger.log("[Background] Active tab changed in recorded window:", activeInfo.tabId);

        // Notify old tab it's no longer 'active' for recording purposes (optional, if we want to stop it sending events)
        if (state.recordingTabId && state.recordingTabId !== activeInfo.tabId) {
            try {
                // We're just updating our internal pointer. Content scripts send events blindly, we filter them here.
                // But we should probably tell the new tab it's being recorded so it gets the overlay/status?
                // Actually, in window mode, all tabs might need to know?
                // For now, let's just update our pointer.
            } catch (e) { }
        }

        state.recordingTabId = activeInfo.tabId;

        // Fetch Tab Info to get URL
        try {
            const tab = await chrome.tabs.get(activeInfo.tabId);
            if (tab.url) {
                // Synthesize URL Change Event
                const urlEvent: UrlChangeEvent = {
                    type: EventType.URLCHANGE,
                    timestamp: Date.now() - state.startTime,
                    url: tab.url,
                    title: tab.title || '',
                    mousePos: { x: 0, y: 0 }
                };
                state.events.push(urlEvent);
                logger.log("[Background] Synthesized URLCHANGE for new tab:", tab.url);
            }

            // Notify the new tab that it is now "active" and recorded (so it can show UI if needed)
            // In a perfect world we broadcast to all tabs in window, but focusing on the active one is efficient.
            chrome.tabs.sendMessage(activeInfo.tabId, {
                type: MSG.RECORDING_STATUS_CHANGED,
                isRecording: true,
                startTime: state.startTime
            }).catch(() => {
                // If it fails, maybe inject?
                // For now, assuming content script is everywhere.
            });

        } catch (e) {
            logger.error("[Background] Failed to handle tab switch:", e);
        }
    }
});

function categorizeEvents(events: any[]): UserEvents {
    const categorized: UserEvents = {
        mouseClicks: [],
        mousePositions: [],
        keyboardEvents: [],
        drags: [],
        scrolls: [],
        typingEvents: [],
        urlChanges: []
    };

    for (const e of events) {
        switch (e.type) {
            case EventType.CLICK:
                categorized.mouseClicks.push(e as MouseClickEvent);
                break;
            case EventType.MOUSEPOS:
                categorized.mousePositions.push(e as MousePositionEvent);
                break;
            case EventType.KEYDOWN:
                categorized.keyboardEvents.push(e as KeyboardEvent);
                break;
            case EventType.MOUSEDRAG:
                categorized.drags.push(e as DragEvent);
                break;
            case EventType.SCROLL:
                categorized.scrolls.push(e as any);
                break;
            case EventType.TYPING:
                categorized.typingEvents.push(e as TypingEvent);
                break;
            case EventType.URLCHANGE:
                categorized.urlChanges.push(e as UrlChangeEvent);
                break;
            default:
                break;
        }
    }
    return categorized;
}

// Event Listener
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    // Logging Middleware
    const isUserEvent = Object.values(EventType).includes(message.type.toLowerCase() as any);
    if (!isUserEvent && message.type !== 'PING_OFFSCREEN') { // Also ignore PINGs to avoid noise
        const senderInfo = _sender.tab ? `Tab:${_sender.tab.id}` : 'Popup/Ext';
        logger.log(`[Background] RX ${message.type} from ${senderInfo}`, message);
    }

    // 1. Event Capture
    if (isUserEvent) {
        // ... (existing logic)
        // Logic: Accept events if:
        // 1. We are recording.
        // 2. The sender is a tab.
        // 3. The sender tab matches our 'recordingTabId'.
        if (state.isRecording && _sender.tab && _sender.tab.id === state.recordingTabId) {
            const eventType = message.type.toLowerCase();
            const eventWithMeta = { ...message.payload, type: eventType };
            state.events.push(eventWithMeta);
        }
        return true;
    } else if (message.type === MSG.GET_RECORDING_STATE) {
        let isRecording = state.isRecording;

        // If query comes from a Content Script (tab), strictly check if *that* tab is the recording one.
        // This ensures the overlay only shows on the recorded tab.
        if (_sender.tab?.id) {
            const targetTabId = _sender.tab.id;
            // If in Window mode, we mostly care if it's the active tab that we are tracking
            if (state.recordingMode === 'window') {
                // Logic: Only the active tab in the recorded window gets the 'REC' status/overlay
                isRecording = state.isRecording && targetTabId === state.recordingTabId;
            } else {
                isRecording = state.isRecording && targetTabId === state.recordingTabId;
            }
        }
        // If query comes from Popup (no tab), return global state (isRecording)

        const responseState = {
            isRecording: isRecording,
            startTime: state.startTime
        };
        // logger.log("[Background] Sending GET_RECORDING_STATE response", responseState); 
        sendResponse(responseState);

    } else if (message.type === MSG.START_RECORDING) {
        const { tabId, recordingMode } = message;

        (async () => {
            try {
                let recorderTabId: number | null = null;

                // 1. Setup Recording Environment
                // Window Mode -> Needs a real tab for desktopCapture permissions
                // Tab Mode -> Can use invisible offscreen document
                if (recordingMode === 'window') {
                    const tab = await chrome.tabs.create({
                        url: 'src/calibration/index.html',
                        active: true, // Must be active for user to see the picker
                        index: 0
                    });
                    if (tab.id) recorderTabId = tab.id;
                } else {
                    await setupOffscreenDocument('src/offscreen/offscreen.html');
                }


                let streamId;
                if (recordingMode === 'window') {
                    // Window Recording: requires targetting the recorder tab
                    if (!recorderTabId) throw new Error("Failed to create recorder tab");

                    // Wait for tab to be fully loaded
                    await new Promise<void>((resolve) => {
                        const listener = (uTabId: number, changeInfo: any) => {
                            if (uTabId === recorderTabId && changeInfo.status === 'complete') {
                                chrome.tabs.onUpdated.removeListener(listener);
                                resolve();
                            }
                        };
                        chrome.tabs.onUpdated.addListener(listener);
                        // Check if already loaded
                        chrome.tabs.get(recorderTabId, (t) => {
                            if (t && t.status === 'complete') {
                                chrome.tabs.onUpdated.removeListener(listener);
                                resolve();
                            }
                        });
                        // Safety timeout
                        setTimeout(() => {
                            chrome.tabs.onUpdated.removeListener(listener);
                            resolve();
                        }, 5000);
                    });

                    let targetTab = undefined;
                    try {
                        targetTab = await chrome.tabs.get(recorderTabId);
                        logger.log("[Background] Recorder tab ready for picker:", targetTab);
                    } catch (e) {
                        logger.error("[Background] Failed to get recorder tab", e);
                    }

                    streamId = await new Promise<string>((resolve, reject) => {
                        chrome.desktopCapture.chooseDesktopMedia(['window', 'screen'], targetTab, (id) => {
                            if (!id) return reject(new Error("User cancelled selection"));
                            resolve(id);
                        });
                    });

                } else {
                    // Tab Recording
                    streamId = await chrome.tabCapture.getMediaStreamId({
                        targetTabId: tabId
                    });
                }

                if (!streamId) throw new Error("Failed to get stream ID");


                // Prepare Recorder (Wait for PING)
                // Both Tab and Offscreen listen to runtime messages, so this logic is shared.
                await waitForOffscreen();


                // Get Dimensions (of the start tab)
                let dimensions: Size | null = null;
                try {
                    const tId = tabId;
                    if (tId) {
                        const result = await chrome.scripting.executeScript({
                            target: { tabId: tId },
                            func: () => ({
                                width: window.innerWidth,
                                height: window.innerHeight,
                                dpr: window.devicePixelRatio
                            })
                        });
                        if (result && result[0] && result[0].result) {
                            const { width, height, dpr } = result[0].result;
                            dimensions = { width: Math.round(width * dpr), height: Math.round(height * dpr) };
                        }
                    }
                } catch (e: any) {
                    logger.warn("Failed to get dims via script injection", e);
                }

                if (!dimensions && state.activeCalibrationDimensions) {
                    console.log("[Background] Using reported calibration dimensions fallback");
                    dimensions = state.activeCalibrationDimensions;
                }

                if (!dimensions) {
                    throw new Error("Could not retrieve tab dimensions. Cannot start recording.");
                }


                // Prepare Message
                const preparePromise = new Promise<void>((resolve, reject) => {
                    const listener = (msg: any) => {
                        if (msg.type === MSG.RECORDING_PREPARED) {
                            chrome.runtime.onMessage.removeListener(listener);
                            resolve();
                        } else if (msg.type === MSG.RECORDING_FAILED) {
                            chrome.runtime.onMessage.removeListener(listener);
                            reject(new Error(msg.error || "Recording preparation failed"));
                        }
                    };
                    chrome.runtime.onMessage.addListener(listener);
                    setTimeout(() => {
                        chrome.runtime.onMessage.removeListener(listener);
                        reject(new Error("Timeout waiting for streams to prepare"));
                    }, 5000);
                });

                console.log("[Background] Sending PREPARE_RECORDING", { streamId, recordingMode, dimensions });
                await chrome.runtime.sendMessage({
                    type: MSG.PREPARE_RECORDING,
                    streamId,
                    data: {
                        ...message,
                        hasAudio: message.hasAudio,
                        hasCamera: message.hasCamera,
                        dimensions,
                        recordingMode
                    }
                });

                await preparePromise;

                // Sync/Countdown
                let syncTimestamp = Date.now();
                if (tabId) {
                    try {
                        await chrome.tabs.sendMessage(tabId, { type: MSG.SHOW_COUNTDOWN });
                        syncTimestamp = await new Promise<number>((resolve, _reject) => {
                            const timeout = setTimeout(() => {
                                chrome.runtime.onMessage.removeListener(listener);
                                resolve(Date.now());
                            }, 5000);

                            const listener = (msg: any, _sender: any) => {
                                if (msg.type === MSG.COUNTDOWN_FINISHED) {
                                    clearTimeout(timeout);
                                    chrome.runtime.onMessage.removeListener(listener);
                                    resolve(msg.timestamp);
                                }
                            };
                            chrome.runtime.onMessage.addListener(listener);
                        });
                    } catch (e) { logger.warn("Countdown failed", e); }
                }

                // Start
                logger.log("[Background] Sending RECORDING_STARTED");
                await chrome.runtime.sendMessage({ type: MSG.RECORDING_STARTED });

                state.isRecording = true;
                state.recordingMode = recordingMode;
                state.recordingTabId = tabId || null;
                state.recorderEnvironmentId = recorderTabId;
                state.startTime = syncTimestamp;
                state.events = [];

                if (recordingMode === 'window' && tabId) {
                    try {
                        const t = await chrome.tabs.get(tabId);
                        state.recordingWindowId = t.windowId;
                    } catch (e) { }
                } else {
                    state.recordingWindowId = null;
                }

                chrome.storage.local.set({
                    currentSessionEvents: [],
                    recordingSyncTimestamp: syncTimestamp
                });

                if (tabId) {
                    logger.log("[Background] Sending RECORDING_STATUS_CHANGED to tab", tabId);
                    chrome.tabs.sendMessage(tabId, { type: MSG.RECORDING_STATUS_CHANGED, isRecording: true, startTime: syncTimestamp }).catch(() => { });
                }

                sendResponse({ success: true });

            } catch (err: any) {
                logger.error("Error starting recording:", err);
                sendResponse({ success: false, error: err.message });
            }
        })();
        return true;

    } else if (message.type === MSG.STOP_RECORDING) {
        // Sort events by timestamp
        state.events.sort((a, b) => a.timestamp - b.timestamp);
        chrome.storage.local.set({ recordingMetadata: state.events });
        const userEvents = categorizeEvents(state.events);

        logger.log("[Background] Sending STOP_RECORDING_OFFSCREEN");
        chrome.runtime.sendMessage({
            type: MSG.STOP_RECORDING_OFFSCREEN,
            events: userEvents // Send categorized object instead of raw array
        });

        state.isRecording = false;
        state.recordingTabId = null;
        state.recordingWindowId = null;

        chrome.storage.local.remove(['recordingSyncTimestamp']);
        sendResponse({ success: true });

    } else if (message.type === MSG.OPEN_EDITOR) {
        chrome.tabs.create({ url: message.url });

        // Cleanup Recording Environment
        if (state.recorderEnvironmentId) {
            chrome.tabs.remove(state.recorderEnvironmentId).catch(() => { });
            state.recorderEnvironmentId = null;
        }
        // Always try to close offscreen (no-op if specific tab was used, but harmless)
        chrome.offscreen.closeDocument().catch(() => { });

    } else if (message.type === MSG.LOG_MESSAGE) {
        const { level, args } = message;
        const prefix = "[Offscreen]";
        if (level === 'error') {
            console.error(prefix, ...args);
        } else if (level === 'warn') {
            console.warn(prefix, ...args);
        } else {
            console.log(prefix, ...args);
        }
    } else if (message.type === MSG.CALIBRATION_DIMENSIONS) {
        state.activeCalibrationDimensions = message.dimensions;
        console.log("[Background] Received calibration dimensions:", state.activeCalibrationDimensions);
    }
    // Note: Do NOT return true unconditionally here.
});
