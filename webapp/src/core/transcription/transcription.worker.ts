/**
 * Transcription Web Worker
 * 
 * Receives 16kHz Float32Array, runs Whisper, returns text + timestamps.
 * Supports language selection with automatic model switching.
 */

import { pipeline, Pipeline, env } from '@huggingface/transformers';

// Configure Transformers.js - use Hugging Face Hub for all models
env.allowRemoteModels = true;
env.allowLocalModels = false;
env.remoteHost = 'https://huggingface.co/';
env.remotePathTemplate = '{model}/resolve/main/';

const MODEL_NAME = 'Xenova/whisper-small.en';

// Types
interface TranscribeMessage {
    type: 'transcribe';
    audioBuffer: ArrayBuffer;
}

interface AbortMessage {
    type: 'abort';
}

type WorkerMessage = TranscribeMessage | AbortMessage;

// State
let whisperPipeline: Pipeline | null = null;
let isLoading = false;
let aborted = false;

async function loadModel(): Promise<void> {
    if (whisperPipeline) return;
    if (isLoading) return;

    isLoading = true;
    self.postMessage({ type: 'model_loading' });

    try {
        // Track per-file download progress and aggregate into a single 0→1 value.
        // Each file reports its own 0→100, so we weight by file size (loaded/total bytes).
        const fileProgress = new Map<string, { loaded: number; total: number }>();

        // @ts-ignore — union type too complex for TS
        whisperPipeline = await pipeline('automatic-speech-recognition', MODEL_NAME, {
            progress_callback: (event: any) => {
                if (event.status === 'progress' && event.file) {
                    fileProgress.set(event.file, { loaded: event.loaded ?? 0, total: event.total ?? 1 });
                    let totalBytes = 0, loadedBytes = 0;
                    for (const f of fileProgress.values()) {
                        totalBytes += f.total;
                        loadedBytes += f.loaded;
                    }
                    self.postMessage({ type: 'model_progress', progress: totalBytes > 0 ? loadedBytes / totalBytes : 0 });
                }
            },
        });
    } finally {
        isLoading = false;
    }
}

async function transcribe(audioBuffer: ArrayBuffer): Promise<void> {
    aborted = false;

    const audioData = new Float32Array(audioBuffer);

    self.postMessage({ type: 'progress', progress: 0.1 });

    await loadModel();

    if (aborted) throw new Error('Aborted');
    if (!whisperPipeline) throw new Error('Model failed to load');

    self.postMessage({ type: 'progress', progress: 0.3 });

    // Fake progress: tick linearly from 0.3 → 0.95 over estimated time
    // Rate: 1 second real-time per 10 seconds of audio
    const audioDurationSec = audioData.length / 16000;
    const estimatedMs = (audioDurationSec / 10) * 1000;
    const PROGRESS_START = 0.3;
    const PROGRESS_CAP = 0.95;
    const fakeStart = Date.now();
    const fakeInterval = setInterval(() => {
        if (aborted) { clearInterval(fakeInterval); return; }
        const t = Math.min((Date.now() - fakeStart) / estimatedMs, 1);
        const progress = PROGRESS_START + t * (PROGRESS_CAP - PROGRESS_START);
        self.postMessage({ type: 'progress', progress });
    }, 100);

    // Audio is already 16kHz - pass directly to Whisper
    const result = await whisperPipeline(audioData, {
        return_timestamps: true,
        chunk_length_s: 30,
        stride_length_s: 5,
    });

    clearInterval(fakeInterval);

    if (aborted) throw new Error('Aborted');

    self.postMessage({
        type: 'result',
        chunks: (result as any).chunks || []
    });
}

self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
    const { type } = event.data;

    if (type === 'abort') {
        aborted = true;
        return;
    }

    if (type === 'transcribe') {
        try {
            await transcribe(event.data.audioBuffer);
        } catch (error) {
            const msg = error instanceof Error ? error.message : 'Unknown error';
            if (msg !== 'Aborted') {
                self.postMessage({ type: 'error', error: msg });
            }
        }
    }
};
