/**
 * Integration test for the real Whisper adapter against the OpenAI API.
 * Third-party tier: needs a real credential, stays out of the blocking
 * CI job and auto-skips without env. Run manually:
 *
 *   OPENAI_API_KEY=sk-... npx vitest run server/test/adapters/transcription
 *
 * Sends ~0.5s of generated tone (fractions of a cent) — shape asserts
 * only, Whisper's output on synthetic audio is not deterministic.
 */
import { describe, expect, it } from 'vitest';
import { createTranscriptionAdapter } from '../../src/adapters/transcription.js';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const hasKey = Boolean(OPENAI_API_KEY?.startsWith('sk-'));

/** Minimal valid WAV: 0.5s mono 8kHz 16-bit 440Hz tone. */
function makeWav(): Uint8Array {
    const sampleRate = 8000;
    const samples = sampleRate / 2;
    const dataSize = samples * 2;
    const buf = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buf);
    const writeStr = (offset: number, s: string) => {
        for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
    };
    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 1, true); // mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeStr(36, 'data');
    view.setUint32(40, dataSize, true);
    for (let i = 0; i < samples; i++) {
        view.setInt16(44 + i * 2, Math.round(Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 8000), true);
    }
    return new Uint8Array(buf);
}

describe.runIf(hasKey)('transcription adapter (real Whisper API)', () => {
    it('returns the TranscriptionResult shape for a tiny WAV', async () => {
        const adapter = createTranscriptionAdapter({ apiKey: OPENAI_API_KEY! });
        const result = await adapter.transcribe({
            bytes: makeWav(),
            fileName: 'audio.wav',
            mimeType: 'audio/wav',
        });

        expect(Array.isArray(result.words)).toBe(true);
        expect(Array.isArray(result.segments)).toBe(true);
        for (const w of result.words) {
            expect(typeof w.word).toBe('string');
            expect(typeof w.start).toBe('number');
            expect(typeof w.end).toBe('number');
        }
        for (const s of result.segments) {
            expect(typeof s.text).toBe('string');
            expect(typeof s.start).toBe('number');
            expect(typeof s.end).toBe('number');
        }
    }, 130_000);
});
