import { pipeline, Pipeline, env } from '@huggingface/transformers';
import type { Captions, CaptionSegment } from './types';

// Configure Transformers.js to download models from Cloudflare CDN
// Models are cached in browser IndexedDB after first download
env.allowRemoteModels = true;
env.allowLocalModels = false;

// Custom domain pointing to Cloudflare R2 bucket for production use
env.remoteHost = 'https://models.recordio.site/';
env.remotePathTemplate = '{model}/';

// Cache models in browser after download
env.cacheDir = '.cache/transformers';

// Configure WASM backend - bundle locally since Chrome blocks dynamic .mjs imports
// @ts-ignore - wasmPaths is not in type definitions
if (env.backends?.onnx?.wasm) {
    env.backends.onnx.wasm.wasmPaths = '/wasm/';
}

/**
 * Service for transcribing webcam audio using Hugging Face Whisper models.
 * Runs locally in the browser using Transformers.js.
 */
export class TranscriptionService {
    private static instance: TranscriptionService | null = null;
    private whisperPipeline: Pipeline | null = null;
    private isLoading = false;

    // Use English-only model - simpler and more reliable
    private readonly MODEL_NAME = 'Xenova/whisper-base.en';

    private constructor() { }

    /**
     * Get singleton instance of the service.
     */
    static getInstance(): TranscriptionService {
        if (!TranscriptionService.instance) {
            TranscriptionService.instance = new TranscriptionService();
        }
        return TranscriptionService.instance;
    }

    /**
     * Check if the Whisper model is loaded.
     */
    isModelLoaded(): boolean {
        return this.whisperPipeline !== null;
    }

    /**
     * Transcribe audio from a webcam video file.
     * 
     * @param videoBlob - The webcam video blob
     * @param onProgress - Optional progress callback (0-1)
     * @returns Transcription data with segments tied to source timestamps
     */
    async transcribeWebcamAudio(
        videoBlob: Blob,
        onProgress?: (progress: number) => void,
        signal?: AbortSignal
    ): Promise<Captions> {
        try {
            if (signal?.aborted) throw new Error('Aborted');

            // Step 1: Extract audio from video (0-30% of progress)
            onProgress?.(0.05);
            const audioData = await this.extractAudioFromVideo(videoBlob);

            if (signal?.aborted) throw new Error('Aborted');

            if (!audioData) {
                throw new Error('No audio track found in webcam video. Cannot transcribe.');
            }

            onProgress?.(0.3);

            // Step 2: Load English model (30-60% of progress)
            console.log('[TranscriptionService] Loading model:', this.MODEL_NAME);

            if (!this.whisperPipeline) {
                await this.loadModel(this.MODEL_NAME);
            }

            if (signal?.aborted) throw new Error('Aborted');

            onProgress?.(0.6);

            // Step 3: Run transcription (60-95% of progress)
            if (!this.whisperPipeline) {
                throw new Error('Whisper model failed to load.');
            }

            // Note: transformers.js pipeline might not support signal directly yet, 
            // but we check before running.
            const result = await this.whisperPipeline(audioData, {
                return_timestamps: true,
                chunk_length_s: 30,
                stride_length_s: 5
            });

            if (signal?.aborted) throw new Error('Aborted');

            onProgress?.(0.95);

            // Step 4: Convert to our format (95-100% of progress)
            const segments = this.convertToSegments(result);
            onProgress?.(1.0);

            return {
                segments,
                generatedAt: new Date()
            };
        } catch (error) {
            console.error('[TranscriptionService] Transcription failed:', error);
            throw error;
        }
    }

    /**
     * Load the Whisper model.
     */
    private async loadModel(modelName: string): Promise<void> {
        if (this.isLoading) {
            // Wait for existing load to complete
            while (this.isLoading) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            return;
        }

        this.isLoading = true;

        try {
            console.log('[TranscriptionService] Loading Whisper model:', modelName);
            // @ts-ignore - Transformers.js pipeline type is too complex for TypeScript
            this.whisperPipeline = await pipeline('automatic-speech-recognition', modelName);
            console.log('[TranscriptionService] Model loaded successfully');
        } catch (error) {
            console.error('[TranscriptionService] Failed to load model:', error);
            throw new Error(`Failed to load Whisper model: ${error instanceof Error ? error.message : 'Unknown error'}`);
        } finally {
            this.isLoading = false;
        }
    }

    /**
     * Extract audio from video blob and convert to format suitable for Whisper.
     * Returns Float32Array of audio samples at 16kHz mono, or null if no audio.
     */
    private async extractAudioFromVideo(videoBlob: Blob): Promise<Float32Array | null> {
        const audioContext = new AudioContext({ sampleRate: 16000 });

        try {
            // Create video element to load the blob
            const videoUrl = URL.createObjectURL(videoBlob);
            const video = document.createElement('video');
            video.src = videoUrl;

            // Wait for video to load
            await new Promise<void>((resolve, reject) => {
                video.onloadedmetadata = () => resolve();
                video.onerror = () => reject(new Error('Failed to load video'));
            });

            // Check if video has audio track
            const mediaStream = (video as any).captureStream?.() || (video as any).mozCaptureStream?.();
            if (!mediaStream || mediaStream.getAudioTracks().length === 0) {
                console.warn('[TranscriptionService] No audio tracks found in video');
                URL.revokeObjectURL(videoUrl);
                return null;
            }

            // Decode audio from video
            const arrayBuffer = await videoBlob.arrayBuffer();
            const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

            // Convert to mono Float32Array
            const channelData = audioBuffer.getChannelData(0); // Use first channel
            const samples = new Float32Array(channelData.length);
            samples.set(channelData);

            URL.revokeObjectURL(videoUrl);
            await audioContext.close();

            console.log('[TranscriptionService] Extracted audio:', {
                duration: audioBuffer.duration,
                sampleRate: audioBuffer.sampleRate,
                channels: audioBuffer.numberOfChannels,
                samples: samples.length
            });

            return samples;
        } catch (error) {
            await audioContext.close();
            console.error('[TranscriptionService] Audio extraction failed:', error);
            throw new Error(`Failed to extract audio: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Convert Transformers.js result to our CaptionSegment format.
     */
    private convertToSegments(result: any): CaptionSegment[] {
        const segments: CaptionSegment[] = [];

        if (!result || !result.chunks) {
            console.error('[TranscriptionService] Invalid transcription result:', result);
            throw new Error('Invalid transcription result from Whisper model');
        }

        console.log('[TranscriptionService] Processing', result.chunks.length, 'chunks');

        for (let i = 0; i < result.chunks.length; i++) {
            const chunk = result.chunks[i];
            const text = chunk.text?.trim() || '';

            // Skip empty or whitespace-only segments
            if (!text || text.length === 0) {
                console.log('[TranscriptionService] Skipping empty chunk at index', i);
                continue;
            }

            // Whisper returns timestamps in seconds, convert to milliseconds
            const sourceStartMs = Math.round((chunk.timestamp[0] || 0) * 1000);
            const sourceEndMs = Math.round((chunk.timestamp[1] || sourceStartMs + 1000) * 1000);

            segments.push({
                id: crypto.randomUUID(),
                text,
                sourceStartMs,
                sourceEndMs
            });
        }

        console.log('[TranscriptionService] Generated segments:', segments.length, '(filtered from', result.chunks.length, 'chunks)');
        return segments;
    }

    /**
     * Dispose of the model and free resources.
     */
    dispose(): void {
        this.whisperPipeline = null;
        console.log('[TranscriptionService] Disposed');
    }
}
