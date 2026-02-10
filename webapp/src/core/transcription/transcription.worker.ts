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

// Model names
const MODEL_NAME_EN = 'Xenova/whisper-base.en';
const MODEL_NAME_MULTILINGUAL = 'Xenova/whisper-base';

// Types
interface TranscribeMessage {
    type: 'transcribe';
    audioBuffer: ArrayBuffer;
    language?: string;
}

interface AbortMessage {
    type: 'abort';
}

type WorkerMessage = TranscribeMessage | AbortMessage;

// State
let whisperPipeline: Pipeline | null = null;
let currentModelName: string | null = null;
let isLoading = false;
let aborted = false;

async function loadModel(language: string): Promise<void> {
    const modelName = language === 'en' ? MODEL_NAME_EN : MODEL_NAME_MULTILINGUAL;

    // If we already have the right model loaded, skip
    if (whisperPipeline && currentModelName === modelName) return;
    if (isLoading) return;

    isLoading = true;

    try {
        // @ts-ignore - Hugging Face Hub configured at module level
        whisperPipeline = await pipeline('automatic-speech-recognition', modelName);
        currentModelName = modelName;
    } finally {
        isLoading = false;
    }
}

async function transcribe(audioBuffer: ArrayBuffer, language: string = 'en'): Promise<void> {
    aborted = false;

    const audioData = new Float32Array(audioBuffer);

    self.postMessage({ type: 'progress', progress: 0.1 });

    await loadModel(language);

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

    // Build pipeline options
    const pipelineOptions: any = {
        return_timestamps: true,
        chunk_length_s: 30,
        stride_length_s: 5
    };

    // For non-English, pass language to multilingual model
    if (language !== 'en') {
        pipelineOptions.language = language;
    }

    // Audio is already 16kHz - pass directly to Whisper
    const result = await whisperPipeline(audioData, pipelineOptions);

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
            await transcribe(event.data.audioBuffer, event.data.language);
        } catch (error) {
            const msg = error instanceof Error ? error.message : 'Unknown error';
            if (msg !== 'Aborted') {
                self.postMessage({ type: 'error', error: msg });
            }
        }
    }
};
