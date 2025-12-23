let screenRecorder: MediaRecorder | null = null;
let cameraRecorder: MediaRecorder | null = null;

let screenData: BlobPart[] = [];
let cameraData: BlobPart[] = [];

let audioContext: AudioContext | null = null;

// Keep track of streams to stop them later
let activeStreams: MediaStream[] = [];
let startTime = 0;
let projectId: string | null = null;

import type { Size } from '../core/types';

// Notify background that we are ready
chrome.runtime.sendMessage({ type: 'OFFSCREEN_READY' });

chrome.runtime.onMessage.addListener(async (message) => {
    if (message.type === 'PREPARE_RECORDING') {
        const { streamId, data: { hasAudio, hasCamera, audioDeviceId, videoDeviceId, dimensions } } = message as {
            streamId: string;
            data: {
                hasAudio: boolean;
                hasCamera: boolean;
                audioDeviceId?: string;
                videoDeviceId?: string;
                dimensions?: Size;
            };
        };

        try {
            cleanup(); // Ensure clean state

            // 1. Get Screen Stream (Video + System Audio)
            const videoConstraints: any = {
                mandatory: {
                    chromeMediaSource: 'tab',
                    chromeMediaSourceId: streamId
                }
            };

            if (dimensions) {
                videoConstraints.mandatory.minWidth = dimensions.width;
                videoConstraints.mandatory.minHeight = dimensions.height;
                videoConstraints.mandatory.maxWidth = dimensions.width;
                videoConstraints.mandatory.maxHeight = dimensions.height;
            }

            const screenStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    mandatory: {
                        chromeMediaSource: 'tab',
                        chromeMediaSourceId: streamId
                    }
                } as any,
                video: videoConstraints
            });
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
            chrome.runtime.sendMessage({ type: 'RECORDING_PREPARED' });

        } catch (err) {
            console.error("Offscreen recording error:", err);
            cleanup();
        }
    } else if (message.type === 'START_RECORDING') {
        startTime = Date.now();
        projectId = crypto.randomUUID();
        if (screenRecorder && screenRecorder.state === 'inactive') screenRecorder.start();
        if (cameraRecorder && cameraRecorder.state === 'inactive') cameraRecorder.start();

        // Ack
        chrome.runtime.sendMessage({ type: 'RECORDING_STARTED', startTime });

    } else if (message.type === 'STOP_RECORDING_OFFSCREEN') {
        stopRecording();
    } else if (message.type === 'PING_OFFSCREEN') {
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

async function stopRecording() {
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
        const sourceId = `src-${projectId}-screen`;

        // Save Blob
        await saveToIndexedDB('recording', blobId, blob, duration, projectId, screenDimensions);

        // Save Source Metadata
        // Note: Events are currently empty here. They might be populated by the Editor from chrome.storage
        const source = {
            id: sourceId,
            type: 'video',
            url: `recordo-blob://${blobId}`, // Virtual / Placeholder
            durationMs: duration,
            size: screenDimensions || { width: 1920, height: 1080 },
            hasAudio: true,
            events: [],
            createdAt: now
        };
        await saveToIndexedDB('source', sourceId, source, duration, projectId);
    }

    // Save Camera
    if (cameraData.length > 0) {
        const blob = new Blob(cameraData, { type: 'video/webm' });
        const blobId = `rec-${projectId}-camera`;
        // TODO: Save Camera Source/Events if needed
        await saveToIndexedDB('recording', blobId, blob, duration, projectId, cameraDimensions);
    }

    // 3. Cleanup & Notify
    screenData = [];
    cameraData = [];
    cleanup();

    chrome.runtime.sendMessage({ type: 'OPEN_EDITOR', url: `src/editor/index.html?projectId=${projectId}` });
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
        const request = indexedDB.open('RecordoDB', 2); // Version 2

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
