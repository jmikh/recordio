
import { type Size, EventType, type UserEvents, type MouseClickEvent, type MousePositionEvent, type KeyboardEvent, type DragEvent, type TypingEvent, type UrlChangeEvent } from '../core/types';
import { logger } from '../utils/logger';

logger.log("Background service worker running");

interface BackgroundState {
    isRecording: boolean;
    recordingTabId: number | null;
    startTime: number;
    events: any[];
}

const state: BackgroundState = {
    isRecording: false,
    recordingTabId: null,
    startTime: 0,
    events: []
};

// Hydrate state on startup (in case service worker woke up)
// We only really care about events or metadata that might be needed after a crash/restart strictly for recovery?
// But for active recording state (streams), those die on restart anyway, so restoring 'isRecording=true' is actually correct ONLY if SW woke up but runtime didn't restart.
// However, since we use offscreen document for recording, the SW lifecycle is less critical for the stream itself?
// Actually, offscreen doc dies if extension reloads.
// So let's NOT restore 'isRecording' blindly.


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
// This ensures we get the compiled .js output path (e.g. assets/content.js) instead of the .ts source
import contentScriptPath from '../content/index.ts?script';

// On Install/Update: Inject content script into existing tabs
chrome.runtime.onInstalled.addListener(async () => {
    console.log("[Background] Extension Installed/Updated. Injecting content scripts...");
    // Query ALL tabs (host_permissions should allow us to access them now)
    const tabs = await chrome.tabs.query({});
    console.log(`[Background] Found ${tabs.length} tabs to check.`, tabs);

    for (const tab of tabs) {
        if (tab.id && tab.url && !tab.url.startsWith("chrome://") && !tab.url.startsWith("edge://") && !tab.url.startsWith("about:")) {
            try {
                // Check if already injected? No easy way, just re-inject.
                await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    files: [contentScriptPath]
                });
                console.log(`[Background] Injected into tab ${tab.id} (${tab.url})`);
            } catch (err: any) {
                // Ignore errors (e.g. restricted pages)
                console.warn(`[Background] Failed to inject into tab ${tab.id} (${tab.url})`, err.message);
            }
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
                // Ignore unknown types
                break;
        }
    }
    return categorized;
}

// Event Listener
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    // 1. Event Capture
    if (Object.values(EventType).includes(message.type.toLowerCase() as any)) {
        // Only accept events from the tab we are currently recording
        if (state.isRecording && _sender.tab && _sender.tab.id === state.recordingTabId) {
            // Append event type to payload for easy storage
            const eventType = message.type.toLowerCase();
            const eventWithMeta = { ...message.payload, type: eventType };

            // Map event names to our internal schema:
            // CLICK_EVENT -> 'click' (done above by replace)
            // KEYDOWN -> 'keydown'

            state.events.push(eventWithMeta);
        }
        return true;
    } else if (message.type === 'GET_RECORDING_STATE') {
        let isRecording = state.isRecording;

        // "Robust" Logic:
        // 1. If sender has a tab (Content Script), check if it matches the recording tab.
        // 2. Else (Popup), return global state.

        const targetTabId = _sender.tab?.id;

        if (targetTabId) {
            isRecording = state.isRecording && targetTabId === state.recordingTabId;
        }
        console.log("[Background] GET_RECORDING_STATE", { isRecording, startTime: state.startTime });

        const responseState = {
            isRecording: isRecording,
            startTime: state.startTime
        };
        sendResponse(responseState);
    } else if (message.type === 'START_RECORDING') {
        const { tabId } = message;

        (async () => {
            try {
                await setupOffscreenDocument('src/offscreen/offscreen.html');

                // Get stream ID
                const streamId = await chrome.tabCapture.getMediaStreamId({
                    targetTabId: tabId
                });

                // Wait for offscreen to be truly ready
                // We poll by sending a 'PING' message until we get a success (meaning the listener is active)
                // Sending 'OFFSCREEN_READY' from offscreen is good, but if it was already alive we missed it.
                // Best way: Background sends PING, offscreen responds PONG.

                let attempts = 0;
                while (attempts < 20) {
                    try {
                        await chrome.runtime.sendMessage({ type: 'PING_OFFSCREEN' });
                        break; // Success!
                    } catch (e) {
                        attempts++;
                        await new Promise(r => setTimeout(r, 100)); // Wait 100ms
                    }
                }

                if (attempts >= 20) {
                    throw new Error("Offscreen recorder timed out.");
                }

                // 0. Get Tab Dimensions
                // TODO: figureout how to deal with that error. (analytics?)
                let dimensions: Size = { width: 1920, height: 1080 };
                try {
                    const result = await chrome.scripting.executeScript({
                        target: { tabId },
                        func: () => ({
                            width: window.innerWidth,
                            height: window.innerHeight,
                            dpr: window.devicePixelRatio
                        })
                    });
                    if (result && result[0] && result[0].result) {
                        const { width, height, dpr } = result[0].result;
                        dimensions = { width: Math.round(width * dpr), height: Math.round(height * dpr) };
                        logger.log(`[Background] Target Tab Dimensions: ${width}x${height} @ ${dpr}x -> ${dimensions.width}x${dimensions.height}`);
                    }
                } catch (e) {
                    logger.warn("[Background] Failed to get tab dimensions, using default.", e);
                }


                // 1. Prepare Recording (Start Streams, paused)
                logger.log("[Background] Preparing Recording Streams...");

                const preparePromise = new Promise<void>((resolve, reject) => {
                    const listener = (msg: any) => {
                        if (msg.type === 'RECORDING_PREPARED') {
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
                    type: 'PREPARE_RECORDING',
                    streamId,
                    data: {
                        ...message,
                        hasAudio: message.hasAudio,
                        hasCamera: message.hasCamera,
                        dimensions // Pass dimensions to offscreen
                    }
                });

                await preparePromise;
                logger.log("[Background] Streams Prepared.");

                // 2. Trigger Countdown & Wait for Sync Timestamp
                logger.log("[Background] Triggering Countdown...");

                let syncTimestamp = Date.now(); // Fallback
                try {
                    await chrome.tabs.sendMessage(tabId, { type: 'SHOW_COUNTDOWN' });

                    // Wait for finish
                    syncTimestamp = await new Promise<number>((resolve, _reject) => {
                        const timeout = setTimeout(() => {
                            chrome.runtime.onMessage.removeListener(listener);
                            logger.warn("[Background] Countdown timed out, using fallback.");
                            resolve(Date.now());
                        }, 5000); // 3s countdown + buffer

                        const listener = (msg: any, _sender: any) => {
                            if (msg.type === 'COUNTDOWN_FINISHED') {
                                clearTimeout(timeout);
                                chrome.runtime.onMessage.removeListener(listener);
                                resolve(msg.timestamp);
                            }
                        };
                        chrome.runtime.onMessage.addListener(listener);
                    });
                    logger.log("[Background] Countdown finished at:", syncTimestamp);
                } catch (e) {
                    logger.warn("[Background] Failed to run countdown UI:", e);
                }

                // 3. Start Actual Recording (MediaRecorder.start)
                await chrome.runtime.sendMessage({ type: 'START_RECORDING' });

                state.isRecording = true;
                state.recordingTabId = tabId;
                state.startTime = syncTimestamp;
                state.events = []; // Reset events

                // Store Sync Timestamp (optional now, but good for debug)
                // We DO NOT store isRecording=true here anymore to avoid stale state on reload.
                chrome.storage.local.set({
                    currentSessionEvents: [],
                    recordingSyncTimestamp: syncTimestamp,
                    // isRecording: true, // REMOVED
                    // recordingTabId: tabId // REMOVED
                });

                // Notify content script safely
                logger.log("[Background] Sending RECORDING_STATUS_CHANGED=true to tab", tabId);

                try {
                    await chrome.tabs.sendMessage(tabId, { type: 'RECORDING_STATUS_CHANGED', isRecording: true, startTime: syncTimestamp });
                    logger.log("[Background] Message sent successfully.");
                } catch (err: any) {
                    logger.log("[Background] Message failed. Attempting injection...", err.message);

                    try {
                        // Inject the content script manually
                        // Note: 'files' path is relative to the extension root
                        await chrome.scripting.executeScript({
                            target: { tabId },
                            files: ['src/content/index.ts']
                        });
                        logger.log("[Background] Injection successful. Retrying message...");

                        // Give it a moment to initialize listeners
                        await new Promise(r => setTimeout(r, 200));

                        await chrome.tabs.sendMessage(tabId, { type: 'RECORDING_STATUS_CHANGED', isRecording: true, startTime: syncTimestamp });
                        logger.log("[Background] Retry message sent successfully.");
                    } catch (injectErr: any) {
                        logger.warn("Could not inject content script. Page might be restricted (e.g. chrome:// URL).", injectErr.message);
                    }
                }

                sendResponse({ success: true });
            } catch (err: any) {
                logger.error("Error starting recording:", err);
                sendResponse({ success: false, error: err.message });
            }
        })();
        return true; // Keep channel open
    } else if (message.type === 'STOP_RECORDING') {
        // Sort events by timestamp
        state.events.sort((a, b) => a.timestamp - b.timestamp);

        logger.log("[Background] Saving final events:", state.events.length);
        chrome.storage.local.set({ recordingMetadata: state.events });

        const userEvents = categorizeEvents(state.events);

        chrome.runtime.sendMessage({
            type: 'STOP_RECORDING_OFFSCREEN',
            events: userEvents // Send categorized object instead of raw array
        });
        state.isRecording = false;
        state.recordingTabId = null;

        // Clear persistence
        chrome.storage.local.remove(['recordingSyncTimestamp']);

        sendResponse({ success: true });
    } else if (message.type === 'OPEN_EDITOR') {
        chrome.tabs.create({ url: message.url });
    }
});
