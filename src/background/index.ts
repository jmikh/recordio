import { logger } from '../utils/logger';

logger.log("Background service worker running");

interface BackgroundState {
    isRecording: boolean;
    events: any[];
}

const state: BackgroundState = {
    isRecording: false,
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
chrome.runtime.onInstalled.addListener(async () => {
    console.log("[Background] Extension Installed/Updated. Injecting content scripts...");
    const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] });
    for (const tab of tabs) {
        if (tab.id) {
            try {
                await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    files: ['src/content/index.ts']
                });
                console.log(`[Background] Injected into tab ${tab.id}`);
            } catch (err) {
                // Ignore errors (e.g. restricted pages)
                // console.warn(`[Background] Failed to inject into tab ${tab.id}`, err);
            }
        }
    }
});

// Event Listener
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    // 1. Event Capture
    if (['MOUSE_POS', 'URL_CHANGE', 'KEYDOWN', 'MOUSEDOWN', 'MOUSEUP', 'DOM_MUTATION', 'CLICK'].includes(message.type)) {
        if (state.isRecording) {
            // Append event type to payload for easy storage
            const eventWithMeta = { ...message.payload, type: message.type.toLowerCase().replace('_event', '') };

            // Map event names to our internal schema:
            // CLICK_EVENT -> 'click' (done above by replace)
            // MOUSE_POS -> 'mouse_pos' -> 'mouse'
            // URL_CHANGE -> 'url_change' -> 'url'
            // KEYDOWN -> 'keydown'
            // DOM_MUTATION -> 'dom_mutation' -> 'mutation'

            if (eventWithMeta.type === 'mouse_pos') eventWithMeta.type = 'mouse';
            if (eventWithMeta.type === 'url_change') eventWithMeta.type = 'url';
            if (eventWithMeta.type === 'dom_mutation') eventWithMeta.type = 'mutation';

            state.events.push(eventWithMeta);

            // Optionally back up to storage periodically
            chrome.storage.local.set({ currentSessionEvents: state.events });
        }
        return true;
    } else if (message.type === 'GET_RECORDING_STATE') {
        sendResponse({ isRecording: state.isRecording });
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
                let dimensions = { width: 1920, height: 1080 };
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
                state.events = []; // Reset events

                // Store Sync Timestamp (optional now, but good for debug)
                chrome.storage.local.set({
                    currentSessionEvents: [],
                    recordingSyncTimestamp: syncTimestamp
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
        chrome.runtime.sendMessage({ type: 'STOP_RECORDING_OFFSCREEN' });
        state.isRecording = false;

        // Notify all tabs (or just active)
        chrome.tabs.query({}, (tabs) => {
            tabs.forEach(tab => {
                if (tab.id) {
                    chrome.tabs.sendMessage(tab.id, { type: 'RECORDING_STATUS_CHANGED', isRecording: false })
                        .catch(() => {
                            // Ignore errors for tabs without content script
                        });
                }
            });
        });

        // No post-processing needed as content script handles click/drag details
        // Sort events by timestamp to ensure chronological order (buffered events might arrive late)
        state.events.sort((a, b) => a.timestamp - b.timestamp);

        logger.log("[Background] Saving final events:", state.events.length);
        chrome.storage.local.set({ recordingMetadata: state.events });

        sendResponse({ success: true });
    } else if (message.type === 'OPEN_EDITOR') {
        chrome.tabs.create({ url: message.url });
    }
});
