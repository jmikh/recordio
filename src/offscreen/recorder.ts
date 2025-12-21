let screenRecorder: MediaRecorder | null = null;
let cameraRecorder: MediaRecorder | null = null;

let screenData: BlobPart[] = [];
let cameraData: BlobPart[] = [];

let audioContext: AudioContext | null = null;

// Keep track of streams to stop them later
let activeStreams: MediaStream[] = [];
let startTime = 0;
let sessionId: string | null = null;

// Notify background that we are ready
chrome.runtime.sendMessage({ type: 'OFFSCREEN_READY' });

chrome.runtime.onMessage.addListener(async (message) => {
    if (message.type === 'PREPARE_RECORDING') {
        const { streamId, data: { hasAudio, hasCamera, audioDeviceId, videoDeviceId, dimensions } } = message;

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
        sessionId = crypto.randomUUID();
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

    // Save Screen
    if (screenData.length > 0) {
        const blob = new Blob(screenData, { type: 'video/webm' });
        // Get dimensions from tracks if possible, else 1920x1080 default
        // We will just store simple blob for now.
        await saveToIndexedDB('latest', blob, startTime, duration, sessionId);
    }

    // Save Camera
    if (cameraData.length > 0) {
        const blob = new Blob(cameraData, { type: 'video/webm' });
        await saveToIndexedDB('latest-camera', blob, startTime, duration, sessionId);
    }

    // 3. Cleanup & Notify
    screenData = [];
    cameraData = [];
    cleanup();

    chrome.runtime.sendMessage({ type: 'OPEN_EDITOR', url: 'src/editor/index.html' });
}

async function saveToIndexedDB(key: string, blob: Blob, startTime: number, duration: number, sessionId: string | null) {
    return new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('RecordoDB', 1);

        request.onupgradeneeded = (event: any) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains('recordings')) {
                db.createObjectStore('recordings', { keyPath: 'id' });
            }
        };

        request.onsuccess = (event: any) => {
            const db = event.target.result;
            const transaction = db.transaction(['recordings'], 'readwrite');
            const store = transaction.objectStore('recordings');

            // Find width/height? Complex to decode blob here. 
            // We'll let the editor figure it out from the blob URL.

            const recording = {
                id: key,
                blob: blob,
                duration: duration,
                startTime: startTime,
                timestamp: Date.now(),
                sessionId: sessionId
            };

            const putRequest = store.put(recording);
            putRequest.onsuccess = () => resolve();
            putRequest.onerror = () => reject(putRequest.error);
        };
        request.onerror = () => reject(request.error);
    });
}
