import { supabase } from '../../auth/AuthManager';
import type { CaptionSegment } from '@shared/types';

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

/**
 * Cloud transcription service using the transcribe edge function + OpenAI Whisper API.
 * Returns CaptionSegment[] with word-level timestamps.
 */
export class CloudTranscriptionService {
    static async transcribe(
        projectId: string,
        onProgress?: (progress: number) => void,
    ): Promise<CaptionSegment[]> {
        if (!supabase) {
            throw new Error('Supabase not configured');
        }

        onProgress?.(0.1);

        const { data, error } = await supabase.functions.invoke('transcribe', {
            body: { projectId },
        });

        if (error) {
            // supabase-js wraps non-2xx responses in FunctionsHttpError
            const body = typeof data === 'object' ? data : {};

            if (body?.error === 'rate_limit_exceeded') {
                throw new RateLimitError({
                    cycleMinutesUsed: body.cycleMinutesUsed ?? 0,
                    cycleMinutesLimit: body.cycleMinutesLimit ?? 0,
                    resetsAt: body.resetsAt ?? '',
                });
            }

            throw new Error(body?.message || body?.error || error.message || 'Transcription failed');
        }

        onProgress?.(0.9);

        // Map edge function segments to CaptionSegment format
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
