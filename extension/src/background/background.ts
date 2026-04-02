/**
 * @fileoverview Background Service Worker (Thin Router)
 * 
 * Minimal orchestrator for the Recordio extension:
 * - Extension icon click → Opens/manages controller tab
 * - Tracks recording state for popup display
 * - Handles website handoff (external message port streaming)
 * - Detects controller tab closure → auto-stop
 * 
 * The controller tab handles all recording logic directly.
 */

import { initSentry, captureException } from '../utils/sentry';
import { trackRecordingStarted, trackRecordingFinished, trackRecordingErrored, getDistinctId } from '../utils/mixpanel';

import { SECONDARY_COLOR_HEX, TEXT_ON_SECONDARY_HEX } from '../utils/colors';
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
    mode: null,
    originalTabId: null,
    hasAudio: false,
    hasCamera: false,
};

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
    if (!currentState?.isRecording || !currentState.startTime) {
        return;
    }
    const elapsed = Date.now() - currentState.startTime;
    const text = formatRecordingTime(elapsed);
    chrome.action.setBadgeText({ text });
}

function startBadgeTimer() {
    chrome.action.setBadgeBackgroundColor({ color: SECONDARY_COLOR_HEX });
    chrome.action.setBadgeTextColor({ color: TEXT_ON_SECONDARY_HEX });
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

chrome.runtime.onInstalled.addListener(async (details) => {
    // Open welcome page on fresh install (not updates)
    if (details.reason === 'install') {
        chrome.tabs.create({ url: getEditorOrigin() + '/welcome' });
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

// --- Extension Icon Click Handler ---
// When not recording: open controller tab (no popup)
// When recording: popup is already set, Chrome shows it automatically

chrome.action.onClicked.addListener(async (tab) => {
    await ensureState();

    if (currentState?.isRecording) {
        // This shouldn't fire when popup is set, but just in case
        return;
    }

    // Close any existing controller tab
    if (currentState?.controllerTabId) {
        await closeControllerTab(currentState.controllerTabId);
    }

    // Remember the current tab as the original tab
    const originalTabId = tab.id || null;

    // Open fresh controller tab
    const controllerTabId = await openControllerTab();

    await saveState({
        controllerTabId,
        originalTabId,
    });
});

// --- Message Handlers ---

async function handleStopSession(sendResponse: Function) {
    stopBadgeTimer();
    await ensureState();

    // Track recording_finished
    if (currentState?.isRecording && currentState.startTime) {
        const duration_ms = Date.now() - currentState.startTime;
        trackRecordingFinished({
            mode: currentState.mode || 'window',
            duration_ms,
            hasAudio: currentState.hasAudio,
            hasCamera: currentState.hasCamera,
        });
    }

    const finalSessionId = currentState?.currentSessionId;

    // Broadcast stop to all content scripts
    const stopEventsMsg = {
        type: MSG_TYPES.STOP_RECORDING_EVENTS,
        payload: { sessionId: finalSessionId }
    };
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
        if (tab.id) {
            chrome.tabs.sendMessage(tab.id, stopEventsMsg).catch(() => { });
        }
    }

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
    if (sessionId) {
        const importUrl = buildImportUrl(sessionId);
        chrome.tabs.create({ url: importUrl });
    }

    // Reset state
    await saveState({
        isRecording: false,
        controllerTabId: null,
        currentSessionId: null,
        mode: null,
        originalTabId: null,
    });

    // Clear popup so next icon click goes to onClicked handler
    chrome.action.setPopup({ popup: '' });

    // Close controller tab
    if (controllerTabId) {
        closeControllerTab(controllerTabId);
    }
}

function handleGetRecordingState(_sender: chrome.runtime.MessageSender, sendResponse: Function) {
    if (!currentState) return sendResponse({ isRecording: false, startTime: 0 });

    sendResponse({
        isRecording: currentState.isRecording,
        startTime: currentState.startTime,
        hasAudio: currentState.hasAudio,
        hasCamera: currentState.hasCamera,
        mode: currentState.mode
    });
}

// --- Tab Removal Listener ---
// Detect if the controller tab is closed during recording
chrome.tabs.onRemoved.addListener(async (tabId) => {
    await ensureState();
    if (!currentState) return;

    const isControllerTab = currentState.controllerTabId === tabId;

    if (isControllerTab && currentState.isRecording) {
        // Controller closed while recording — auto-stop
        handleStopSession(() => { });
    } else if (isControllerTab && !currentState.isRecording) {
        // Controller closed before recording started — just clear the ref
        await saveState({ controllerTabId: null });
    }
});

// --- Main Listener ---

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    (async () => {
        await ensureState();
        if (!currentState) return;

        switch (message.type) {
            case MSG_TYPES.STOP_SESSION:
                handleStopSession(sendResponse);
                break;

            case MSG_TYPES.GET_RECORDING_STATE:
                handleGetRecordingState(_sender, sendResponse);
                break;

            case MSG_TYPES.CONTROLLER_STARTED_RECORDING: {
                // Controller tab tells us recording has begun
                const { sessionId, mode, hasAudio, hasCamera, originalTabId } = message.payload || {};
                const syncTimestamp = Date.now();

                await saveState({
                    isRecording: true,
                    controllerTabId: _sender.tab?.id || currentState.controllerTabId,
                    startTime: syncTimestamp,
                    currentSessionId: sessionId,
                    mode: mode || 'window',
                    originalTabId: originalTabId || currentState.originalTabId,
                    hasAudio: hasAudio || false,
                    hasCamera: hasCamera || false,
                });

                // Enable popup for stop-recording UI
                chrome.action.setPopup({ popup: 'src/popup/index.html' });

                // Start badge timer
                startBadgeTimer();

                trackRecordingStarted({
                    mode: mode || 'window',
                    hasAudio: hasAudio || false,
                    hasCamera: hasCamera || false,
                });

                sendResponse({ success: true, startTime: syncTimestamp });
                break;
            }

            case MSG_TYPES.CONTROLLER_STOPPED_RECORDING: {
                // Controller has finished saving the recording data.
                // Now clean up: open import page, reset state, close controller tab.
                stopBadgeTimer();

                if (currentState?.isRecording && currentState.startTime) {
                    const duration_ms = Date.now() - currentState.startTime;
                    trackRecordingFinished({
                        mode: currentState.mode || 'window',
                        duration_ms,
                        hasAudio: currentState.hasAudio,
                        hasCamera: currentState.hasCamera,
                    });
                }

                // Broadcast stop to content scripts
                const stopEventsMsg = {
                    type: MSG_TYPES.STOP_RECORDING_EVENTS,
                    payload: { sessionId: currentState?.currentSessionId }
                };
                const allTabs = await chrome.tabs.query({});
                for (const tab of allTabs) {
                    if (tab.id) {
                        chrome.tabs.sendMessage(tab.id, stopEventsMsg).catch(() => { });
                    }
                }

                await handleRecordingFinished(
                    currentState?.currentSessionId || null,
                    currentState?.controllerTabId || null
                );
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
} from '@shared/types/bridge';

// Cache for pending handoff data (between metadata request and stream)
const pendingHandoffs = new Map<string, {
    recording: RawRecording;
    screenBlob: Blob;
    cameraBlob?: Blob;
    micBlob?: Blob;
}>();

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
    (async () => {
        switch (message.type) {
            case BRIDGE_MSG.HANDOFF_REQUEST:
                await handleHandoffRequest(message.payload as HandoffRequestPayload, sendResponse);
                break;

            case BRIDGE_MSG.HANDOFF_COMPLETE:
                await handleHandoffComplete(message.payload as HandoffCompletePayload);
                sendResponse({ success: true });
                break;

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

        const screenBlobId = recording.screenSource.storageUrl.replace('recordio-blob://', '');
        const screenBlob = await ProjectStorage.getRecordingBlob(screenBlobId);

        if (!screenBlob) {
            throw new Error('Screen blob not found');
        }

        let cameraBlob: Blob | undefined;
        if (recording.cameraSource?.storageUrl) {
            const cameraBlobId = recording.cameraSource.storageUrl.replace('recordio-blob://', '');
            cameraBlob = await ProjectStorage.getRecordingBlob(cameraBlobId);
        }

        let micBlob: Blob | undefined;
        if (recording.microphoneSource?.storageUrl) {
            const micBlobId = recording.microphoneSource.storageUrl.replace('recordio-blob://', '');
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
