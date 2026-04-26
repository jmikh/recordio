import type { Word, CaptionSegment } from '../types';

/** Weight per word: letter count + base value (matches the old karaoke algorithm). */
const WORD_BASE_VALUE = 3;

/**
 * Derive display text from a caption segment's words.
 * When `visibleOnly` is true, hidden words are excluded from the result.
 */
export function getSegmentText(segment: CaptionSegment, visibleOnly = false): string {
    const words = visibleOnly
        ? segment.words.filter(w => !w.hidden)
        : segment.words;
    return words.map(w => w.word).join(' ');
}

/**
 * Convert a text string into Word[] with proportionally-distributed timestamps.
 * Used when word-level timestamps aren't available (local transcription, migration,
 * or manual caption editing).
 */
export function textToWords(
    text: string,
    sourceStartTimeMs: number,
    sourceEndTimeMs: number,
): Word[] {
    const parts = text.split(/\s+/).filter(w => w.length > 0);
    if (parts.length === 0) return [];

    const duration = sourceEndTimeMs - sourceStartTimeMs;
    const weights = parts.map(w => w.length + WORD_BASE_VALUE);
    const totalWeight = weights.reduce((sum, w) => sum + w, 0);

    let cursor = sourceStartTimeMs;
    return parts.map((word, i) => {
        const wordDuration = (weights[i] / totalWeight) * duration;
        const start = Math.round(cursor);
        cursor += wordDuration;
        const end = Math.round(cursor);
        return {
            id: crypto.randomUUID(),
            word,
            sourceStartTimeMs: start,
            sourceEndTimeMs: end,
            outputStartTimeMs: 0,
            outputEndTimeMs: 0,
            visible: false,
        };
    });
}
