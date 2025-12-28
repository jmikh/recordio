let screenRecorder: MediaRecorder | null = null;
let cameraRecorder: MediaRecorder | null = null;

let screenData: BlobPart[] = [];
let cameraData: BlobPart[] = [];

let audioContext: AudioContext | null = null;

// Keep track of streams to stop them later
let activeStreams: MediaStream[] = [];
let startTime = 0;
let projectId: string | null = null;
let calibrationOffset: number | null = null;
let currentRecordingMode: 'tab' | 'window' | null = null;

import type { Size, SourceMetadata, UserEvents } from '../core/types';
import { MSG } from '../shared/messages';
import { checkWindowCalibration, remapUserEvents } from './calibration-logic';


// Notify background that we are ready
chrome.runtime.sendMessage({ type: MSG.OFFSCREEN_READY });

// Forward logs to background
function forwardLogs() {
    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;

    console.log = (...args) => {
        originalLog(...args); // Keep local logging
        chrome.runtime.sendMessage({ type: MSG.LOG_MESSAGE, level: 'log', args });
    };

    console.warn = (...args) => {
        originalWarn(...args);
        chrome.runtime.sendMessage({ type: MSG.LOG_MESSAGE, level: 'warn', args });
    };

    console.error = (...args) => {
        originalError(...args);
        chrome.runtime.sendMessage({ type: MSG.LOG_MESSAGE, level: 'error', args });
    };
}
forwardLogs();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    // Dispatch logic
    if (message.type === MSG.PREPARE_RECORDING) {
        handlePrepare(message);
        return true;
    } else if (message.type === MSG.RECORDING_STARTED) {
        handleRecordingStarted(message);
        return true;
    } else if (message.type === MSG.STOP_RECORDING_OFFSCREEN) {
        const events = message.events || [];
        stopRecording(events);
        return true;
    } else if (message.type === MSG.PING_OFFSCREEN) {
        sendResponse("PONG");
    }
    // Return false/undefined for unhandled messages (like START_RECORDING which is for BG)
});

// Helper functions to keep listener clean and avoid async wrapper for non-async parts
async function handlePrepare(message: any) {
    console.log("[Recorder] Received PREPARE_RECORDING", message);
    const { streamId, data: { hasAudio, hasCamera, audioDeviceId, videoDeviceId, recordingMode, dimensions } } = message;

    const targetDimensions = dimensions || null;

    try {
        cleanup(); // Ensure clean state
        currentRecordingMode = recordingMode;

        // 1. Get Screen Stream (Video + System Audio)
        const source = recordingMode === 'window' ? 'desktop' : 'tab';
        console.log(`[Recorder] Requesting User Media. Source: ${source}, StreamId: ${streamId}`);

        const videoConstraints: any = {
            mandatory: {
                chromeMediaSource: source,
                chromeMediaSourceId: streamId
            }
        };

        if (targetDimensions && recordingMode === 'tab') {
            videoConstraints.mandatory.maxWidth = targetDimensions.width;
            videoConstraints.mandatory.maxHeight = targetDimensions.height;
            videoConstraints.mandatory.minWidth = targetDimensions.width;
            videoConstraints.mandatory.minHeight = targetDimensions.height;
        }

        console.log("[Recorder] Video Constraints:", JSON.stringify(videoConstraints, null, 2));

        let screenStream;
        try {
            screenStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    mandatory: {
                        chromeMediaSource: source,
                        chromeMediaSourceId: streamId
                    }
                } as any,
                video: videoConstraints
            });
            console.log("[Recorder] Got Screen Stream (Audio+Video)", screenStream.id);
        } catch (err: any) {
            console.warn(`[Offscreen] Failed to get screen stream with audio. Name: ${err.name}, Message: ${err.message}`, err);
            try {
                // Fallback: Video only (System audio might not be available or user unchecked it)
                screenStream = await navigator.mediaDevices.getUserMedia({
                    audio: false,
                    video: videoConstraints
                });
                console.log("[Recorder] Got Screen Stream (Video Only)", screenStream.id);
            } catch (err2: any) {
                console.error(`[Offscreen] Failed video-only fallback. Name: ${err2.name}, Message: ${err2.message}`, err2);
                throw err2;
            }
        }
        activeStreams.push(screenStream);

        // --- CALIBRATION & CAPTURE ---
        if (recordingMode === 'window' && targetDimensions) {
            console.log("[Recorder] Starting Calibration Check...");
            (async () => {
                try {
                    const result = await checkWindowCalibration(
                        screenStream,
                        targetDimensions,
                        window.devicePixelRatio || 1
                    );
                    console.log("[Recorder] Calibration Result:", result);

                    if (result && result.success) {
                        calibrationOffset = result.yOffset;
                        chrome.runtime.sendMessage({
                            type: 'CALIBRATION_COMPLETE',
                            calibration: result
                        });
                    } else {
                        console.log("[Calibration] Failed to detect markers.");
                    }
                } catch (calErr) {
                    console.error("[Recorder] Calibration error:", calErr);
                }
            })();
        }

        // MONITOR SYSTEM AUDIO: Connect tab audio to speakers so user can hear it
        if (screenStream.getAudioTracks().length > 0) {
            if (!audioContext) audioContext = new AudioContext();
            const sysSource = audioContext.createMediaStreamSource(screenStream);
            sysSource.connect(audioContext.destination);
        }

        // 2. Get Microphone Audio if requested
        let micStream: MediaStream | null = null;
        if (hasAudio) {
            console.log("[Recorder] Requesting Mic Stream...");
            try {
                const audioConstraints = audioDeviceId
                    ? { deviceId: { exact: audioDeviceId } }
                    : true;
                micStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
                activeStreams.push(micStream);
                console.log("[Recorder] Got Mic Stream", micStream.id);
            } catch (micErr) {
                console.warn("[Recorder] Failed to get microphone", micErr);
            }
        }

        // 3. Prepare Recorders
        if (hasCamera) {
            console.log("[Recorder] Requesting Camera Stream...");
            // --- DUAL RECORDING MODE ---

            // A. Camera Stream setup
            try {
                const camVideoConstraints = videoDeviceId
                    ? { deviceId: { exact: videoDeviceId } }
                    : true;
                const rawCameraStream = await navigator.mediaDevices.getUserMedia({ video: camVideoConstraints });
                activeStreams.push(rawCameraStream);
                console.log("[Recorder] Got Camera Stream", rawCameraStream.id);

                // Mix Camera Video + Mic Audio
                const cameraTracks = [...rawCameraStream.getVideoTracks()];
                if (micStream) {
                    cameraTracks.push(...micStream.getAudioTracks());
                }
                const cameraFinalStream = new MediaStream(cameraTracks);

                // B. Screen Stream setup (Screen Video + System Audio)
                // We use screenStream directly.

                // Initialize Recorders
                screenRecorder = new MediaRecorder(screenStream, { mimeType: 'video/webm;codecs=vp9' });
                cameraRecorder = new MediaRecorder(cameraFinalStream, { mimeType: 'video/webm;codecs=vp9' });

                screenData = [];
                cameraData = [];

                // Event Handlers
                screenRecorder.ondataavailable = (e) => { if (e.data.size > 0) screenData.push(e.data); };
                cameraRecorder.ondataavailable = (e) => { if (e.data.size > 0) cameraData.push(e.data); };
            } catch (camErr) {
                console.error("[Recorder] Camera setup failed", camErr);
            }

        } else {
            // --- SINGLE RECORDING MODE (Screen + Mic + System) ---

            // Need to mix Mic + System Audio if both exist
            let finalScreenStream = screenStream;

            if (micStream) {
                audioContext = new AudioContext();
                const dest = audioContext.createMediaStreamDestination();

                if (screenStream.getAudioTracks().length > 0) {
                    const sysSource = audioContext.createMediaStreamSource(screenStream);
                    sysSource.connect(dest);
                }

                const micSource = audioContext.createMediaStreamSource(micStream);
                micSource.connect(dest);

                const mixedTracks = [
                    ...screenStream.getVideoTracks(),
                    dest.stream.getAudioTracks()[0] // Mixed Audio
                ];
                finalScreenStream = new MediaStream(mixedTracks);
            }

            screenRecorder = new MediaRecorder(finalScreenStream, { mimeType: 'video/webm;codecs=vp9' });
            screenData = [];
            screenRecorder.ondataavailable = (e) => { if (e.data.size > 0) screenData.push(e.data); };
        }

        // NOTIFY READY
        console.log("[Recorder] Sending RECORDING_PREPARED");
        chrome.runtime.sendMessage({ type: MSG.RECORDING_PREPARED });

    } catch (err: any) {
        console.error("Offscreen recording error:", err);
        chrome.runtime.sendMessage({
            type: MSG.RECORDING_FAILED,
            error: err.message || "Unknown offscreen error"
        });
        cleanup();
    }
}

async function handleRecordingStarted(_message: any) {
    startTime = Date.now();
    projectId = crypto.randomUUID();
    if (screenRecorder && screenRecorder.state === 'inactive') screenRecorder.start();
    if (cameraRecorder && cameraRecorder.state === 'inactive') cameraRecorder.start();

    // Ack
    chrome.runtime.sendMessage({ type: MSG.RECORDING_STARTED, startTime });
}

function cleanup() {
    activeStreams.forEach(s => s.getTracks().forEach(t => t.stop()));
    activeStreams = [];
    if (audioContext) {
        audioContext.close();
        audioContext = null;
    }
    screenRecorder = null;
    cameraRecorder = null;
    calibrationOffset = null;
    currentRecordingMode = null;
    // Do not clear data here, we need to save it first
}

async function stopRecording(events: UserEvents) {
    // 1. Stop Recorders
    const promises = [];

    // Capture dimensions before stopping
    let screenDimensions: Size | undefined;
    console.log("screen dimensions:", screenDimensions);
    console.log("screen recorder:", screenRecorder);
    if (screenRecorder && screenRecorder.stream) {
        const videoTrack = screenRecorder.stream.getVideoTracks()[0];
        console.log("video track:", videoTrack);
        if (videoTrack) {
            const settings = videoTrack.getSettings();
            if (settings.width && settings.height) {
                screenDimensions = { width: settings.width, height: settings.height };
                console.log("screen dimensions:", screenDimensions);
            }
        }
    }

    let cameraDimensions: Size | undefined;
    if (cameraRecorder && cameraRecorder.stream) {
        const videoTrack = cameraRecorder.stream.getVideoTracks()[0];
        if (videoTrack) {
            const settings = videoTrack.getSettings();
            if (settings.width && settings.height) {
                cameraDimensions = { width: settings.width, height: settings.height };
            }
        }
    }

    if (screenRecorder && screenRecorder.state !== 'inactive') {
        promises.push(new Promise<void>(resolve => {
            if (!screenRecorder) return resolve();
            screenRecorder.onstop = () => resolve();
            screenRecorder.stop();
        }));
    }

    if (cameraRecorder && cameraRecorder.state !== 'inactive') {
        promises.push(new Promise<void>(resolve => {
            if (!cameraRecorder) return resolve();
            cameraRecorder.onstop = () => resolve();
            cameraRecorder.stop();
        }));
    }

    await Promise.all(promises);

    // 2. Save Data
    const now = Date.now();
    const duration = now - startTime;

    if (!projectId) projectId = crypto.randomUUID();

    // Save Screen
    if (screenData.length > 0) {
        const blob = new Blob(screenData, { type: 'video/webm' });
        const blobId = `rec-${projectId}-screen`;
        const eventsBlobId = `evt-${projectId}-screen`;
        const sourceId = `src-${projectId}-screen`;

        // Save Video Blob
        await saveToIndexedDB('recording', blobId, blob, duration, projectId, screenDimensions);

        // Process Events: Remap if needed
        let finalEvents = events;

        console.log('[Recorder] Processing events for storage', {
            mode: currentRecordingMode,
            calibrationOffset,
            eventCount: events.mouseClicks.length + events.mousePositions.length // simple proxy for count
        });

        if (currentRecordingMode === 'window' && calibrationOffset !== null) {
            console.log('[Recorder] Remapping events with offset:', calibrationOffset);
            finalEvents = remapUserEvents(events, calibrationOffset);
        } else if (currentRecordingMode !== 'tab') {
            console.warn('[Recorder] Discarding events: Window mode active but no calibration offset found.');
            finalEvents = {
                mouseClicks: [],
                mousePositions: [],
                keyboardEvents: [],
                drags: [],
                scrolls: [],
                typingEvents: [],
                urlChanges: []
            };
        } else {
            console.log('[Recorder] Saving raw events (Tab mode).');
        }
        // Save Events Blob
        const eventsBlob = new Blob([JSON.stringify(finalEvents)], { type: 'application/json' });
        await saveToIndexedDB('recording', eventsBlobId, eventsBlob, duration, projectId);

        // Save Source Metadata
        console.log("screen dimensions in metdata:", screenDimensions);
        const source: SourceMetadata = {
            id: sourceId,
            type: 'video',
            url: `recordo-blob://${blobId}`,
            eventsUrl: `recordo-blob://${eventsBlobId}`,
            durationMs: duration,
            size: screenDimensions as Size,
            hasAudio: true,
            createdAt: now
        };
        await saveToIndexedDB('source', sourceId, source, duration, projectId);
    }

    // Save Camera
    if (cameraData.length > 0) {
        const blob = new Blob(cameraData, { type: 'video/webm' });
        const blobId = `rec-${projectId}-camera`;
        const sourceId = `src-${projectId}-camera`; // Create Source for Camera too

        // Save Camera Blob
        await saveToIndexedDB('recording', blobId, blob, duration, projectId, cameraDimensions);

        // Save Camera Source Metadata (No events usually)
        const source: SourceMetadata = {
            id: sourceId,
            type: 'video',
            url: `recordo-blob://${blobId}`,
            // eventsUrl: ... camera usually has no interaction events
            durationMs: duration,
            size: cameraDimensions || { width: 1280, height: 720 }, // Fallback
            hasAudio: false, // Audio is mixed into screen usually, or check config
            createdAt: now
        };
        await saveToIndexedDB('source', sourceId, source, duration, projectId);
    }

    // 3. Cleanup & Notify
    screenData = [];
    cameraData = [];
    cleanup();

    chrome.runtime.sendMessage({ type: MSG.OPEN_EDITOR, url: `src/editor/index.html?projectId=${projectId}` });
}

async function saveToIndexedDB(
    type: 'recording' | 'source',
    id: string,
    data: any,
    duration: number,
    projectId: string | null,
    dimensions?: Size
) {
    return new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('RecordoDB', 1); // Version 1 

        request.onupgradeneeded = (event: any) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains('recordings')) {
                db.createObjectStore('recordings', { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains('sources')) {
                db.createObjectStore('sources', { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains('projects')) {
                db.createObjectStore('projects', { keyPath: 'id' });
            }
        };

        request.onsuccess = (event: any) => {
            const db = event.target.result;
            const txName = type === 'recording' ? 'recordings' : 'sources';
            const transaction = db.transaction([txName], 'readwrite');
            const store = transaction.objectStore(txName);

            let item;
            if (type === 'recording') {
                item = {
                    id: id,
                    blob: data,
                    // Legacy/Additional metadata kept in blob entry just in case
                    duration: duration,
                    startTime: startTime,
                    timestamp: Date.now(),
                    sessionId: projectId,
                    dimensions: dimensions
                };
            } else {
                item = data;
            }

            const putRequest = store.put(item);
            putRequest.onsuccess = () => resolve();
            putRequest.onerror = () => reject(putRequest.error);
        };
        request.onerror = () => reject(request.error);
    });
}
