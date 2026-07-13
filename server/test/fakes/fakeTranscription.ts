import type { TranscriptionPort, TranscriptionResult } from '../../src/ports/transcription.js';

export interface FakeTranscription extends TranscriptionPort {
    requests: Array<{ fileName: string; mimeType: string; byteLength: number }>;
    /** Returned by transcribe(); override per test */
    result: TranscriptionResult;
}

export function createFakeTranscription(): FakeTranscription {
    const fake: FakeTranscription = {
        requests: [],
        result: {
            words: [
                { word: 'Hello', start: 0.0, end: 0.4 },
                { word: 'world', start: 0.5, end: 0.9 },
            ],
            segments: [{ text: 'Hello world', start: 0.0, end: 0.9 }],
        },

        async transcribe(audio) {
            fake.requests.push({
                fileName: audio.fileName,
                mimeType: audio.mimeType,
                byteLength: audio.bytes.byteLength,
            });
            return fake.result;
        },
    };
    return fake;
}
