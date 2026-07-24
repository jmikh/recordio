import { supabase } from '../../auth/AuthManager';
import { invokeFunction } from '../../api/client';
import type { CaptionSegment } from '@shared/types';

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

        // error/message only appear on error responses
        const { data, error } = await invokeFunction<{
            segments: {
                sourceStartTimeMs: number;
                sourceEndTimeMs: number;
                words: { word: string; sourceStartTimeMs: number; sourceEndTimeMs: number }[];
            }[];
            error?: string;
            message?: string;
        }>('transcribe', { projectId });

        if (error) {
            // data is always null alongside error — the previous body
            // fallbacks were dead code
            throw new Error(error.message || 'Transcription failed');
        }

        onProgress?.(0.9);

        // Map edge function segments to CaptionSegment format
        const segments: CaptionSegment[] = (data.segments ?? []).map((seg) => ({
            id: crypto.randomUUID(),
            sourceStartTimeMs: seg.sourceStartTimeMs,
            sourceEndTimeMs: seg.sourceEndTimeMs,
            outputStartTimeMs: 0,
            outputEndTimeMs: 0,
            visible: true,
            words: (seg.words ?? []).map((w) => ({
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
