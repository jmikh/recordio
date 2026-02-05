import type { CaptionSegment } from '../../types';

const SAMPLE_RATE = 16000;

// Message types
interface TranscribeMessage {
    type: 'transcribe';
    audioBuffer: ArrayBuffer;
    language?: string;
}

interface AbortMessage {
    type: 'abort';
}

interface ProgressMessage {
    type: 'progress';
    progress: number;
}

interface ResultMessage {
    type: 'result';
    chunks: Array<{
        text: string;
        timestamp: [number, number | null];
    }>;
}

interface ErrorMessage {
    type: 'error';
    error: string;
}

type WorkerResponse = ProgressMessage | ResultMessage | ErrorMessage;

/**
 * Simple transcription service.
 * Sends entire audio to worker, gets captions back.
 */
export class TranscriptionService {
    private static instance: TranscriptionService | null = null;
    private worker: Worker | null = null;
    private currentReject: ((error: Error) => void) | null = null;

    private constructor() { }

    static getInstance(): TranscriptionService {
        if (!TranscriptionService.instance) {
            TranscriptionService.instance = new TranscriptionService();
        }
        return TranscriptionService.instance;
    }

    private initWorker(): Worker {
        if (!this.worker) {
            this.worker = new Worker(
                new URL('./transcription.worker.ts', import.meta.url),
                { type: 'module' }
            );
        }
        return this.worker;
    }

    /**
     * Decode video/audio blob to 16kHz mono Float32Array.
     */
    private async decodeAudio(blob: Blob): Promise<Float32Array> {
        const audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });

        try {
            const arrayBuffer = await blob.arrayBuffer();
            const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

            // Get mono channel (mix down if stereo)
            let samples: Float32Array;
            if (audioBuffer.numberOfChannels === 1) {
                samples = new Float32Array(audioBuffer.getChannelData(0));
            } else {
                const left = audioBuffer.getChannelData(0);
                const right = audioBuffer.getChannelData(1);
                samples = new Float32Array(left.length);
                for (let i = 0; i < left.length; i++) {
                    samples[i] = (left[i] + right[i]) / 2;
                }
            }

            await audioContext.close();
            return samples;
        } catch (error) {
            await audioContext.close();
            throw error;
        }
    }

    /**
     * Transcribe entire video/audio.
     * Returns captions with timestamps from Whisper.
     */
    async transcribe(
        videoBlob: Blob,
        onProgress?: (progress: number) => void,
        signal?: AbortSignal,
        language: string = 'en'
    ): Promise<CaptionSegment[]> {
        onProgress?.(0.1);

        const samples = await this.decodeAudio(videoBlob);

        if (signal?.aborted) throw new Error('Aborted');

        onProgress?.(0.2);

        const chunks = await this.sendToWorker(
            samples,
            (p) => onProgress?.(0.2 + p * 0.75),
            signal,
            language
        );



        // Convert to CaptionSegments
        const segments: CaptionSegment[] = [];
        for (const chunk of chunks) {
            const text = chunk.text?.trim();
            if (!text) continue;

            segments.push({
                id: crypto.randomUUID(),
                text,
                sourceStartMs: Math.round((chunk.timestamp[0] || 0) * 1000),
                sourceEndMs: Math.round((chunk.timestamp[1] || chunk.timestamp[0] + 1) * 1000)
            });
        }

        onProgress?.(1);
        return segments;
    }

    private sendToWorker(
        samples: Float32Array,
        onProgress?: (progress: number) => void,
        signal?: AbortSignal,
        language: string = 'en'
    ): Promise<Array<{ text: string; timestamp: [number, number | null] }>> {
        const worker = this.initWorker();
        const audioBuffer = samples.buffer.slice(0) as ArrayBuffer;

        return new Promise((resolve, reject) => {
            this.currentReject = reject;

            const cleanup = () => {
                signal?.removeEventListener('abort', abortHandler);
                worker.removeEventListener('message', messageHandler);
            };

            const abortHandler = () => {
                worker.postMessage({ type: 'abort' } as AbortMessage);
                cleanup();
                reject(new Error('Aborted'));
            };

            const messageHandler = (event: MessageEvent<WorkerResponse>) => {
                switch (event.data.type) {
                    case 'progress':
                        onProgress?.(event.data.progress);
                        break;
                    case 'result':
                        cleanup();
                        resolve(event.data.chunks);
                        break;
                    case 'error':
                        cleanup();
                        reject(new Error(event.data.error));
                        break;
                }
            };

            signal?.addEventListener('abort', abortHandler);
            worker.addEventListener('message', messageHandler);

            worker.postMessage(
                { type: 'transcribe', audioBuffer, language } as TranscribeMessage,
                [audioBuffer]
            );
        });
    }

    abort(): void {
        this.worker?.postMessage({ type: 'abort' });
        this.currentReject?.(new Error('Aborted'));
        this.currentReject = null;
    }

    dispose(): void {
        this.worker?.terminate();
        this.worker = null;
    }
}
