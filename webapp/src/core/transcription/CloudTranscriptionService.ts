import { AuthManager } from '../../auth/AuthManager';
import type { CaptionSegment } from '../../types';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || '';

export class RateLimitError extends Error {
    cycleMinutesUsed: number;
    cycleMinutesLimit: number;
    resetsAt: string;

    constructor(data: { cycleMinutesUsed: number; cycleMinutesLimit: number; resetsAt: string }) {
        super('Monthly transcription limit reached');
        this.name = 'RateLimitError';
        this.cycleMinutesUsed = data.cycleMinutesUsed;
        this.cycleMinutesLimit = data.cycleMinutesLimit;
        this.resetsAt = data.resetsAt;
    }
}

const SAMPLE_RATE = 16000;

/**
 * Estimate audio duration from a blob by decoding it.
 */
async function estimateDurationSeconds(blob: Blob): Promise<number> {
    const audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
    try {
        const arrayBuffer = await blob.arrayBuffer();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        return audioBuffer.duration;
    } finally {
        await audioContext.close();
    }
}

/**
 * Cloud transcription service using the backend server + OpenAI Whisper API.
 * Returns CaptionSegment[] with word-level timestamps.
 */
export class CloudTranscriptionService {
    static async transcribe(
        micAudioBlob: Blob,
        language: string,
        onProgress?: (progress: number) => void,
        signal?: AbortSignal,
    ): Promise<CaptionSegment[]> {
        if (!BACKEND_URL) {
            throw new Error('Backend URL not configured');
        }

        onProgress?.(0.05);

        // Get auth token
        const session = await AuthManager.getSession();
        if (!session) {
            throw new Error('Not authenticated');
        }

        if (signal?.aborted) throw new Error('Aborted');
        onProgress?.(0.1);

        // Estimate duration for rate limiting
        const durationSeconds = await estimateDurationSeconds(micAudioBlob);

        if (signal?.aborted) throw new Error('Aborted');
        onProgress?.(0.15);

        // Build form data
        const formData = new FormData();
        formData.append('audio', micAudioBlob);
        formData.append('language', language);
        formData.append('durationSeconds', durationSeconds.toString());

        // Send to backend
        onProgress?.(0.2);
        const response = await fetch(`${BACKEND_URL}/transcribe`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${session.access_token}`,
            },
            body: formData,
            signal,
        });

        if (!response.ok) {
            const body = await response.json().catch(() => ({}));

            if (response.status === 429) {
                throw new RateLimitError({
                    cycleMinutesUsed: body.cycleMinutesUsed ?? 0,
                    cycleMinutesLimit: body.cycleMinutesLimit ?? 0,
                    resetsAt: body.resetsAt ?? '',
                });
            }

            throw new Error(body.message || `Transcription failed (${response.status})`);
        }

        onProgress?.(0.9);

        const data = await response.json();

        // Map backend segments to CaptionSegment format — generate frontend-only fields (id, output times, visible)
        const segments: CaptionSegment[] = (data.segments ?? []).map((seg: any) => ({
            id: crypto.randomUUID(),
            sourceStartTimeMs: seg.sourceStartTimeMs,
            sourceEndTimeMs: seg.sourceEndTimeMs,
            outputStartTimeMs: 0,
            outputEndTimeMs: 0,
            visible: true,
            words: (seg.words ?? []).map((w: any) => ({
                id: crypto.randomUUID(),
                word: w.word,
                sourceStartTimeMs: w.sourceStartTimeMs,
                sourceEndTimeMs: w.sourceEndTimeMs,
                outputStartTimeMs: 0,
                outputEndTimeMs: 0,
                visible: true,
            })),
        }));

        onProgress?.(1);
        return segments;
    }
}
