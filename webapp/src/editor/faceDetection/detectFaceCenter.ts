/**
 * Face detection for the Center Face modal.
 *
 * Uses MediaPipe's BlazeFace short-range model, tuned for faces within ~2m of
 * the camera (webcam distance). The library and its ~12MB WASM runtime are
 * loaded on first use, so they stay out of the main editor bundle.
 */
import type { Detection, FaceDetector } from '@mediapipe/tasks-vision';
import wasmLoaderPath from '@mediapipe/tasks-vision/vision_wasm_internal.js?url';
import wasmBinaryPath from '@mediapipe/tasks-vision/vision_wasm_internal.wasm?url';
import type { Point } from '@shared/types/core';

const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite';

/** Frames sampled across the recording. The median keeps a few frames where the user leans away from skewing the anchor. */
const SAMPLE_COUNT = 8;

/** BlazeFace keypoints 0–3: right eye, left eye, nose tip, mouth center (4–5 are the ears). */
const INNER_FACE_KEYPOINTS = [0, 1, 2, 3];

let detectorPromise: Promise<FaceDetector> | null = null;

function getDetector(): Promise<FaceDetector> {
    if (!detectorPromise) {
        detectorPromise = (async () => {
            const { FaceDetector } = await import('@mediapipe/tasks-vision');
            const create = (delegate: 'GPU' | 'CPU') => FaceDetector.createFromOptions(
                { wasmLoaderPath, wasmBinaryPath },
                { baseOptions: { modelAssetPath: MODEL_URL, delegate }, runningMode: 'IMAGE' },
            );
            // GPU needs WebGL2, which some machines lack
            return create('GPU').catch(() => create('CPU'));
        })();
        // Let a failed load (e.g. offline) be retried on the next call
        detectorPromise.catch(() => { detectorPromise = null; });
    }
    return detectorPromise;
}

function waitForEvent(video: HTMLVideoElement, event: 'loadeddata' | 'seeked'): Promise<void> {
    return new Promise((resolve, reject) => {
        const onDone = () => { cleanup(); resolve(); };
        const onError = () => { cleanup(); reject(new Error(`Video failed while waiting for ${event}`)); };
        const cleanup = () => {
            video.removeEventListener(event, onDone);
            video.removeEventListener('error', onError);
        };
        video.addEventListener(event, onDone);
        video.addEventListener('error', onError);
    });
}

/** Center of the inner face (eyes, nose, mouth), normalized to the frame. Falls back to the bounding box center. */
function faceCenterOf(detection: Detection, frameWidth: number, frameHeight: number): Point | null {
    const keypoints = INNER_FACE_KEYPOINTS.map(i => detection.keypoints[i]).filter(Boolean);
    if (keypoints.length === INNER_FACE_KEYPOINTS.length) {
        return {
            x: keypoints.reduce((sum, k) => sum + k.x, 0) / keypoints.length,
            y: keypoints.reduce((sum, k) => sum + k.y, 0) / keypoints.length,
        };
    }
    const box = detection.boundingBox;
    if (!box) return null;
    return {
        x: (box.originX + box.width / 2) / frameWidth,
        y: (box.originY + box.height / 2) / frameHeight,
    };
}

function median(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Finds where the user's face sits in a camera recording, as a normalized
 * (0–1) point in source video coordinates — the same space as
 * `camera.faceCenter`. Returns null when no face is found in any sampled frame.
 *
 * `durationMs` comes from the source metadata because MediaRecorder WebM
 * files often report an Infinity duration.
 */
export async function detectFaceCenter(videoUrl: string, durationMs: number, signal?: AbortSignal): Promise<Point | null> {
    const detector = await getDetector();
    signal?.throwIfAborted();

    // A separate element, so seeking doesn't move the frame shown in the modal
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    const loaded = waitForEvent(video, 'loadeddata');
    video.src = videoUrl;

    try {
        await loaded;
        const centers: Point[] = [];
        for (let i = 0; i < SAMPLE_COUNT; i++) {
            signal?.throwIfAborted();
            const seeked = waitForEvent(video, 'seeked');
            video.currentTime = (durationMs * (i + 0.5)) / SAMPLE_COUNT / 1000;
            await seeked;

            const { detections } = detector.detect(video);
            const best = detections.reduce<Detection | null>(
                (top, d) => (d.categories[0]?.score ?? 0) > (top?.categories[0]?.score ?? -1) ? d : top,
                null,
            );
            const center = best && faceCenterOf(best, video.videoWidth, video.videoHeight);
            if (center) centers.push(center);
        }

        if (centers.length === 0) return null;
        return {
            x: median(centers.map(c => c.x)),
            y: median(centers.map(c => c.y)),
        };
    } finally {
        // Release the decoder
        video.removeAttribute('src');
        video.load();
    }
}
