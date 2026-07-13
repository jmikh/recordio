/**
 * Transcription port (OpenAI Whisper today). Times are in seconds as the
 * API returns them — conversion to ms is route logic, not translation.
 */
export interface TranscriptionWord {
    word: string;
    start: number;
    end: number;
}

export interface TranscriptionSegment {
    text: string;
    start: number;
    end: number;
}

export interface TranscriptionResult {
    words: TranscriptionWord[];
    segments: TranscriptionSegment[];
}

export interface TranscriptionPort {
    transcribe(audio: { bytes: Uint8Array; fileName: string; mimeType: string }): Promise<TranscriptionResult>;
}
