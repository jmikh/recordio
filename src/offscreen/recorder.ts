let recorder: MediaRecorder | null = null;
let data: BlobPart[] = [];
let audioContext: AudioContext | null = null;
let mixedDest: MediaStreamAudioDestinationNode | null = null;
let mixedStream: MediaStream | null = null;
let animationFrameId: number | null = null;

// Notify background that we are ready
chrome.runtime.sendMessage({ type: 'OFFSCREEN_READY' });

chrome.runtime.onMessage.addListener(async (message) => {
    if (message.type === 'START_RECORDING_OFFSCREEN') {
        const { streamId, data: { hasAudio, hasCamera, audioDeviceId, videoDeviceId } } = message;

        try {
            // 1. Get Screen Stream (Video + System Audio)
            const screenStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    mandatory: {
                        chromeMediaSource: 'tab',
                        chromeMediaSourceId: streamId
                    }
                } as any,
                video: {
                    mandatory: {
                        chromeMediaSource: 'tab',
                        chromeMediaSourceId: streamId
                    }
                } as any
            });

            // 2. Prepare for mixing
            const tracks: MediaStreamTrack[] = [];
            audioContext = new AudioContext();
            mixedDest = audioContext.createMediaStreamDestination();

            // Add system audio to mix if present
            if (screenStream.getAudioTracks().length > 0) {
                const systemSource = audioContext.createMediaStreamSource(screenStream);
                systemSource.connect(mixedDest);
            }

            // 3. Get Microphone Audio if requested
            let micStream: MediaStream | null = null;
            if (hasAudio) {
                const audioConstraints = audioDeviceId
                    ? { deviceId: { exact: audioDeviceId } }
                    : true;

                micStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
                const micSource = audioContext.createMediaStreamSource(micStream);
                micSource.connect(mixedDest);
            }

            // 4. Get Webcam Video if requested and set up canvas for compositing
            let cameraStream: MediaStream | null = null;
            let canvasStream: MediaStream | null = null;

            if (hasCamera) {
                const videoConstraints = videoDeviceId
                    ? { deviceId: { exact: videoDeviceId } }
                    : true;

                cameraStream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints });

                const canvas = document.createElement('canvas');
                // alpha: false helps with color accuracy (no premultiply) and performance
                const ctx = canvas.getContext('2d', { alpha: false });
                if (!ctx) throw new Error("Could not get canvas context");

                const screenVideoTrack = screenStream.getVideoTracks()[0];
                const { width, height } = screenVideoTrack.getSettings();
                canvas.width = width || 1920;
                canvas.height = height || 1080;

                const screenVideoElement = document.createElement('video');
                screenVideoElement.srcObject = screenStream;
                screenVideoElement.muted = true; // Avoid feedback
                await screenVideoElement.play();

                const cameraVideoElement = document.createElement('video');
                cameraVideoElement.srcObject = cameraStream;
                cameraVideoElement.muted = true;
                await cameraVideoElement.play();

                const draw = () => {
                    ctx.drawImage(screenVideoElement, 0, 0, canvas.width, canvas.height);

                    // Draw webcam in bottom right corner
                    const camWidth = canvas.width * 0.2; // 20% width
                    const camHeight = (camWidth / cameraVideoElement.videoWidth) * cameraVideoElement.videoHeight || camWidth * 0.75;
                    const padding = 20;

                    const camX = canvas.width - camWidth - padding;
                    const camY = canvas.height - camHeight - padding;

                    ctx.save();

                    // Draw Border
                    ctx.drawImage(cameraVideoElement, camX, camY, camWidth, camHeight);

                    ctx.strokeStyle = "white";
                    ctx.lineWidth = 4;
                    ctx.strokeRect(camX, camY, camWidth, camHeight);

                    ctx.restore();

                    animationFrameId = requestAnimationFrame(draw);
                };
                draw();

                canvasStream = canvas.captureStream(60); // 60 FPS
                tracks.push(canvasStream.getVideoTracks()[0]);
            } else {
                tracks.push(screenStream.getVideoTracks()[0]);
            }

            // Add mixed audio track
            tracks.push(mixedDest.stream.getAudioTracks()[0]);

            mixedStream = new MediaStream(tracks);

            recorder = new MediaRecorder(mixedStream, { mimeType: 'video/webm;codecs=vp9' });
            data = [];

            let startTime = 0;

            recorder.onstart = () => {
                startTime = Date.now();
            };

            recorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    data.push(event.data);
                }
            };

            recorder.onstop = async () => {
                const blob = new Blob(data, { type: 'video/webm' });
                const duration = Date.now() - startTime;

                if (animationFrameId) cancelAnimationFrame(animationFrameId);
                audioContext?.close();

                // Stop all source streams
                screenStream.getTracks().forEach(t => t.stop());
                micStream?.getTracks().forEach(t => t.stop());
                cameraStream?.getTracks().forEach(t => t.stop());
                mixedStream?.getTracks().forEach(t => t.stop());

                await saveToIndexedDB(blob, duration);
                chrome.runtime.sendMessage({ type: 'OPEN_EDITOR', url: 'src/editor/index.html' });
            };

            recorder.start();
        } catch (err) {
            console.error("Offscreen recording error:", err);
        }
    } else if (message.type === 'STOP_RECORDING_OFFSCREEN') {
        if (recorder && recorder.state !== 'inactive') {
            recorder.stop();
        }
    } else if (message.type === 'PING_OFFSCREEN') {
        return Promise.resolve("PONG");
    }
});

async function saveToIndexedDB(blob: Blob, duration: number) {
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

            const recording = {
                id: 'latest',
                blob: blob,
                duration: duration,
                timestamp: Date.now()
            };

            const putRequest = store.put(recording);

            putRequest.onsuccess = () => resolve();
            putRequest.onerror = () => reject(putRequest.error);
        };

        request.onerror = () => reject(request.error);
    });
}
