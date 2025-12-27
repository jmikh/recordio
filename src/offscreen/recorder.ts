let screenRecorder: MediaRecorder | null = null;
let cameraRecorder: MediaRecorder | null = null;

let screenData: BlobPart[] = [];
let cameraData: BlobPart[] = [];

let audioContext: AudioContext | null = null;

// Keep track of streams to stop them later
let activeStreams: MediaStream[] = [];
let startTime = 0;
let projectId: string | null = null;

import type { Size, SourceMetadata, UserEvents } from '../core/types';
import { MSG } from '../shared/messages';


// Notify background that we are ready
chrome.runtime.sendMessage({ type: MSG.OFFSCREEN_READY });

chrome.runtime.onMessage.addListener(async (message) => {
    if (message.type === MSG.PREPARE_RECORDING) {
        const { streamId, data: { hasAudio, hasCamera, audioDeviceId, videoDeviceId, dimensions, recordingMode } } = message as {
            streamId: string;
            data: {
                hasAudio: boolean;
                hasCamera: boolean;
                audioDeviceId?: string;
                videoDeviceId?: string;
                dimensions?: Size;
                recordingMode: 'tab' | 'window';
            };
        };

        try {
            cleanup(); // Ensure clean state

            // 1. Get Screen Stream (Video + System Audio)
            const source = recordingMode === 'window' ? 'desktop' : 'tab';

            const videoConstraints: any = {
                mandatory: {
                    chromeMediaSource: source,
                    chromeMediaSourceId: streamId
                }
            };

            if (dimensions) {
                videoConstraints.mandatory.minWidth = dimensions.width;
                videoConstraints.mandatory.minHeight = dimensions.height;
                videoConstraints.mandatory.maxWidth = dimensions.width;
                videoConstraints.mandatory.maxHeight = dimensions.height;
            }

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
            } catch (err: any) {
                console.warn(`[Offscreen] Failed to get screen stream with audio. Name: ${err.name}, Message: ${err.message}`, err);
                try {
                    // Fallback: Video only (System audio might not be available or user unchecked it)
                    screenStream = await navigator.mediaDevices.getUserMedia({
                        audio: false,
                        video: videoConstraints
                    });
                } catch (err2: any) {
                    console.error(`[Offscreen] Failed video-only fallback. Name: ${err2.name}, Message: ${err2.message}`, err2);
                    throw err2;
                }
            }
            activeStreams.push(screenStream);

            // MONITOR SYSTEM AUDIO: Connect tab audio to speakers so user can hear it
            if (screenStream.getAudioTracks().length > 0) {
                if (!audioContext) audioContext = new AudioContext();
                const sysSource = audioContext.createMediaStreamSource(screenStream);
                sysSource.connect(audioContext.destination);
            }

            // 2. Get Microphone Audio if requested
            let micStream: MediaStream | null = null;
            if (hasAudio) {
                const audioConstraints = audioDeviceId
                    ? { deviceId: { exact: audioDeviceId } }
                    : true;
                micStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
                activeStreams.push(micStream);
            }

            // 3. Prepare Recorders
            if (hasCamera) {
                // --- DUAL RECORDING MODE ---

                // A. Camera Stream setup
                const camVideoConstraints = videoDeviceId
                    ? { deviceId: { exact: videoDeviceId } }
                    : true;
                const rawCameraStream = await navigator.mediaDevices.getUserMedia({ video: camVideoConstraints });
                activeStreams.push(rawCameraStream);

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
            chrome.runtime.sendMessage({ type: MSG.RECORDING_PREPARED });

        } catch (err) {
            console.error("Offscreen recording error:", err);
            cleanup();
        }
    } else if (message.type === MSG.RECORDING_STARTED) {
        startTime = Date.now();
        projectId = crypto.randomUUID();
        if (screenRecorder && screenRecorder.state === 'inactive') screenRecorder.start();
        if (cameraRecorder && cameraRecorder.state === 'inactive') cameraRecorder.start();

        // Ack
        chrome.runtime.sendMessage({ type: MSG.RECORDING_STARTED, startTime });

    } else if (message.type === MSG.STOP_RECORDING_OFFSCREEN) {
        const events = message.events || [];
        stopRecording(events);
    } else if (message.type === MSG.PING_OFFSCREEN) {
        return Promise.resolve("PONG");
    }
});

function cleanup() {
    activeStreams.forEach(s => s.getTracks().forEach(t => t.stop()));
    activeStreams = [];
    if (audioContext) {
        audioContext.close();
        audioContext = null;
    }
    screenRecorder = null;
    cameraRecorder = null;
    // Do not clear data here, we need to save it first
}

async function stopRecording(events: UserEvents) {
    // 1. Stop Recorders
    const promises = [];

    // Capture dimensions before stopping
    let screenDimensions: Size | undefined;
    if (screenRecorder && screenRecorder.stream) {
        const videoTrack = screenRecorder.stream.getVideoTracks()[0];
        if (videoTrack) {
            const settings = videoTrack.getSettings();
            if (settings.width && settings.height) {
                screenDimensions = { width: settings.width, height: settings.height };
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

        // Save Events Blob
        const eventsBlob = new Blob([JSON.stringify(events)], { type: 'application/json' });
        await saveToIndexedDB('recording', eventsBlobId, eventsBlob, duration, projectId);

        // Save Source Metadata
        const source: SourceMetadata = {
            id: sourceId,
            type: 'video',
            url: `recordo-blob://${blobId}`,
            eventsUrl: `recordo-blob://${eventsBlobId}`,
            durationMs: duration,
            size: screenDimensions || { width: 1920, height: 1080 },
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
