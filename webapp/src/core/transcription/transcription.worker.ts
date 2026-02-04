/**
 * Transcription Web Worker
 * 
 * Receives 16kHz Float32Array, runs Whisper, returns text + timestamps.
 */

import { pipeline, Pipeline, env } from '@huggingface/transformers';

// Configure Transformers.js
env.allowRemoteModels = true;
env.allowLocalModels = false;
env.remoteHost = 'https://models.recordio.site/';
env.remotePathTemplate = '{model}/';
env.cacheDir = '.cache/transformers';

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

const MODEL_NAME = 'Xenova/whisper-base.en';

async function loadModel(): Promise<void> {
    if (whisperPipeline || isLoading) return;
    isLoading = true;

    try {
        console.log('[Worker] Loading model:', MODEL_NAME);
        // @ts-ignore
        whisperPipeline = await pipeline('automatic-speech-recognition', MODEL_NAME);
        console.log('[Worker] Model ready');
    } finally {
        isLoading = false;
    }
}

async function transcribe(audioBuffer: ArrayBuffer): Promise<void> {
    aborted = false;

    const audioData = new Float32Array(audioBuffer);
    console.log('[Worker] Audio received:', audioData.length, 'samples');

    self.postMessage({ type: 'progress', progress: 0.1 });

    if (!whisperPipeline) {
        await loadModel();
    }

    if (aborted) throw new Error('Aborted');
    if (!whisperPipeline) throw new Error('Model failed to load');

    self.postMessage({ type: 'progress', progress: 0.3 });

    console.log('[Worker] Running Whisper...');

    // Audio is already 16kHz - pass directly to Whisper
    const result = await whisperPipeline(audioData, {
        return_timestamps: true,
        chunk_length_s: 30,
        stride_length_s: 5
    });

    if (aborted) throw new Error('Aborted');

    self.postMessage({ type: 'progress', progress: 0.9 });

    console.log('[Worker] Done');
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
