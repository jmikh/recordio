/**
 * Real transcription adapter (OpenAI Whisper) — landed with transcribe.
 *
 * Raw fetch, no `openai` npm package: the API surface used is one
 * multipart POST, and Node 22 has native FormData/File. The request
 * matches the edge fn's SDK call exactly (model, granularities,
 * response_format, prompt).
 *
 * Server-side timeout (documented addition, plan requirement): Railway
 * has no request ceiling and Whisper on long audio can hang — abort at
 * 120 s (the edge runtime's own wall clock was ~150 s, so nothing
 * regresses).
 */
import type { TranscriptionPort, TranscriptionResult } from '../ports/transcription.js';

const TIMEOUT_MS = 120_000;

/** Verbatim from the edge fn — biases Whisper toward clean punctuation. */
const WHISPER_PROMPT =
    'This is a clear, professional recording with proper punctuation and capitalization. ' +
    'The speaker communicates articulately without hesitation.';

interface WhisperVerboseResponse {
    words?: { word: string; start: number; end: number }[];
    segments?: { text?: string; start?: number; end?: number }[];
}

export interface TranscriptionAdapterConfig {
    apiKey: string;
}

export function createTranscriptionAdapter(config: TranscriptionAdapterConfig): TranscriptionPort {
    return {
        async transcribe(audio): Promise<TranscriptionResult> {
            const form = new FormData();
            form.append('model', 'whisper-1');
            form.append('response_format', 'verbose_json');
            form.append('timestamp_granularities[]', 'segment');
            form.append('timestamp_granularities[]', 'word');
            form.append('prompt', WHISPER_PROMPT);
            form.append(
                'file',
                new File([new Uint8Array(audio.bytes)], audio.fileName, { type: audio.mimeType }),
            );

            const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
                method: 'POST',
                headers: { Authorization: `Bearer ${config.apiKey}` },
                body: form,
                signal: AbortSignal.timeout(TIMEOUT_MS),
            });

            if (!res.ok) {
                const snippet = (await res.text().catch(() => '')).slice(0, 300);
                throw new Error(`Whisper API responded ${res.status}: ${snippet}`);
            }

            const body = (await res.json()) as WhisperVerboseResponse;
            return {
                words: (body.words ?? []).map((w) => ({
                    word: w.word,
                    start: w.start,
                    end: w.end,
                })),
                segments: (body.segments ?? []).map((s) => ({
                    text: s.text ?? '',
                    start: s.start ?? 0,
                    end: s.end ?? 0,
                })),
            };
        },
    };
}
