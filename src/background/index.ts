
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
}

const state: BackgroundState = {
    isRecording: false,
    recordingTabId: null,
    recordingWindowId: null,
    recordingMode: 'tab',
    recorderEnvironmentId: null,
    startTime: 0,
    events: []
};


// Ensure offscreen document exists
async function setupOffscreenDocument(path: string) {
    const existingContexts = await chrome.runtime.getContexts({
        contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    });

    if (existingContexts.length > 0) {
        return;
    }

    await chrome.offscreen.createDocument({
        url: path,
        reasons: [chrome.offscreen.Reason.USER_MEDIA],
        justification: 'Recording screen',
    });
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
    // 1. Event Capture
    if (Object.values(EventType).includes(message.type.toLowerCase() as any)) {
        // Logic: Accept events if:
        // 1. We are recording.
        // 2. The sender is a tab.
        // 3. The sender tab matches our 'recordingTabId'.

        // In Window Mode, recordingTabId updates to the currently active tab. 
        // So this logic works for both Tab and Window modes (provided we key updating recordingTabId).

        if (state.isRecording && _sender.tab && _sender.tab.id === state.recordingTabId) {
            const eventType = message.type.toLowerCase();
            const eventWithMeta = { ...message.payload, type: eventType };
            state.events.push(eventWithMeta);
        }
        return true;
    } else if (message.type === MSG.GET_RECORDING_STATE) {
        let isRecording = state.isRecording;
        // In Window Mode, we might want to return true for ANY tab in that window?
        // For now, let's keep strict "active tab" logic for UI indicators if we want to be precise, 
        // OR just return global state for popup.

        // Popup checks this without sender tab (mostly).
        // Content script checks this.

        const targetTabId = _sender.tab?.id;

        if (targetTabId) {
            // For content scripts:
            // If Tab Mode: must match exactly.
            // If Window Mode: must match active tab? OR should we say "true" for all tabs in window?
            // If we say "false" it might hide the overlay. 
            // Let's say: If in Window Mode, any tab in that window is "recording" technically, 
            // but only ACTIVE tab is emitting events. 
            if (state.recordingMode === 'window' && _sender.tab?.windowId === state.recordingWindowId) {
                // It is part of the recorded session.
                // But maybe only active one needs to know?
                // Let's stick to: is it the *active* recording tab?
                isRecording = state.isRecording && targetTabId === state.recordingTabId;
            } else {
                isRecording = state.isRecording && targetTabId === state.recordingTabId;
            }
        }

        const responseState = {
            isRecording: isRecording,
            startTime: state.startTime
        };
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
                        url: 'src/offscreen/offscreen.html',
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
                let attempts = 0;
                while (attempts < 20) {
                    try {
                        await chrome.runtime.sendMessage({ type: MSG.PING_OFFSCREEN });
                        break;
                    } catch (e) {
                        attempts++;
                        await new Promise(r => setTimeout(r, 100));
                    }
                }
                if (attempts >= 20) throw new Error("Recorder environment timed out.");

                // Get Dimensions (of the start tab)
                let dimensions: Size = { width: 1920, height: 1080 };
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
                } catch (e) { logger.warn("Failed to get dims", e); }


                // Prepare Message
                const preparePromise = new Promise<void>((resolve, reject) => {
                    const listener = (msg: any) => {
                        if (msg.type === MSG.RECORDING_PREPARED) {
                            chrome.runtime.onMessage.removeListener(listener);
                            resolve();
                        }
                    };
                    chrome.runtime.onMessage.addListener(listener);
                    setTimeout(() => {
                        chrome.runtime.onMessage.removeListener(listener);
                        reject(new Error("Timeout waiting for streams to prepare"));
                    }, 5000);
                });

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
    }
});
