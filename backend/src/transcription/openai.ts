import OpenAI from 'openai';
import { config } from '../config.js';
import type { TranscribeSegment, TranscribeWord } from './types.js';

const openai = new OpenAI({ apiKey: config.OPENAI_API_KEY });

/**
 * Whisper returns punctuation in segments[].text but strips it from words[].word.
 * Walk through the segment texts token by token and append trailing punctuation
 * back onto the matching word.
 */
function addPunctuationFromSegments(
    words: TranscribeWord[],
    segmentTexts: string[],
): TranscribeWord[] {
    // Tokenize all segment texts into individual tokens (preserving punctuation)
    const tokens: string[] = [];
    for (const text of segmentTexts) {
        for (const token of text.split(/\s+/)) {
            if (token) tokens.push(token);
        }
    }

    const result = words.map(w => ({ ...w }));
    let tokenIdx = 0;

    for (const w of result) {
        if (tokenIdx >= tokens.length) break;
        const token = tokens[tokenIdx];
        // Match: the token should start with the word (case-insensitive)
        const wordLower = w.word.toLowerCase();
        const tokenLower = token.toLowerCase();
        if (tokenLower.startsWith(wordLower) || tokenLower.replace(/[^\w']/g, '') === wordLower.replace(/[^\w']/g, '')) {
            w.word = token; // Use the punctuated version from the segment text
            tokenIdx++;
        } else {
            tokenIdx++;
        }
    }

    return result;
}

/**
 * Transcribe audio using OpenAI Whisper API with word-level timestamps.
 * Returns segments with Word[] — no separate text field.
 */
export async function transcribeAudio(
    audioBuffer: Buffer,
    mimeType: string,
    language: string
): Promise<TranscribeSegment[]> {
    const extMap: Record<string, string> = {
        'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a',
        'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/flac': 'flac',
        'audio/x-m4a': 'm4a', 'video/webm': 'webm', 'video/mp4': 'mp4',
    };
    const ext = extMap[mimeType.split(';')[0]] ?? 'webm';
    const file = new File([new Uint8Array(audioBuffer)], `audio.${ext}`, { type: mimeType });

    const response = await openai.audio.transcriptions.create({
        model: 'whisper-1',
        file,
        timestamp_granularities: ['segment', 'word'],
        response_format: 'verbose_json',
        prompt: 'This is a clear, professional recording with proper punctuation and capitalization. The speaker communicates articulately without hesitation.',
        ...(language !== 'auto' && { language }),
    });

    console.log('[OpenAI] Raw response:', JSON.stringify(response, null, 2));

    // Build word objects from the raw words array
    const rawWords: TranscribeWord[] = (response.words ?? []).map(w => ({
        word: w.word,
        sourceStartTimeMs: Math.round(w.start * 1000),
        sourceEndTimeMs: Math.round(w.end * 1000),
    }));

    if (rawWords.length === 0) {
        return [];
    }

    // Whisper returns punctuation in segments[].text but NOT in words[].word.
    // Use the segment texts to distribute punctuation back onto the words.
    const segmentTexts: string[] = (response.segments ?? []).map((s: any) => s.text?.trim() ?? '');
    const punctuatedWords = addPunctuationFromSegments(rawWords, segmentTexts);

    // Use Whisper's own segments for grouping (they represent natural sentences)
    const whisperSegments: Array<{ start: number; end: number }> =
        (response.segments ?? []).map((s: any) => ({
            start: Math.round((s.start ?? 0) * 1000),
            end: Math.round((s.end ?? 0) * 1000),
        }));

    const segments: TranscribeSegment[] = [];

    for (const ws of whisperSegments) {
        // Find words that fall within this segment's time range
        const segWords = punctuatedWords.filter(
            (w: TranscribeWord) => w.sourceStartTimeMs >= ws.start - 50 && w.sourceEndTimeMs <= ws.end + 50
        );
        if (segWords.length === 0) continue;

        segments.push({
            sourceStartTimeMs: segWords[0].sourceStartTimeMs,
            sourceEndTimeMs: segWords[segWords.length - 1].sourceEndTimeMs,
            words: segWords,
        });
    }

    return segments;
}
