import { describe, it, expect, vi, beforeEach } from 'vitest';
import { textToWords, getSegmentText } from './captionUtils';
import type { CaptionSegment } from '../types';

let uuidCounter = 0;
vi.stubGlobal('crypto', {
    ...crypto,
    randomUUID: () => `uuid-${++uuidCounter}`,
});

beforeEach(() => {
    uuidCounter = 0;
});

// ==========================================
// textToWords
// ==========================================

describe('textToWords', () => {
    it('single word spans full duration', () => {
        const words = textToWords('Hello', 0, 1000);
        expect(words).toHaveLength(1);
        expect(words[0].word).toBe('Hello');
        expect(words[0].sourceStartTimeMs).toBe(0);
        expect(words[0].sourceEndTimeMs).toBe(1000);
    });

    it('multiple words are proportionally distributed', () => {
        const words = textToWords('Hi there', 0, 1000);
        expect(words).toHaveLength(2);
        expect(words[0].word).toBe('Hi');
        expect(words[1].word).toBe('there');
        // First word starts at 0, last word ends at 1000
        expect(words[0].sourceStartTimeMs).toBe(0);
        expect(words[words.length - 1].sourceEndTimeMs).toBe(1000);
        // Words are contiguous (no gaps)
        expect(words[1].sourceStartTimeMs).toBe(words[0].sourceEndTimeMs);
    });

    it('longer words get more time', () => {
        // "a" (1 char + 3 base = 4) vs "longword" (8 chars + 3 base = 11)
        const words = textToWords('a longword', 0, 1500);
        const durationA = words[0].sourceEndTimeMs - words[0].sourceStartTimeMs;
        const durationB = words[1].sourceEndTimeMs - words[1].sourceStartTimeMs;
        expect(durationB).toBeGreaterThan(durationA);
    });

    it('empty string returns empty array', () => {
        expect(textToWords('', 0, 1000)).toEqual([]);
    });

    it('whitespace-only returns empty array', () => {
        expect(textToWords('   ', 0, 1000)).toEqual([]);
    });

    it('multiple spaces between words are handled', () => {
        const words = textToWords('hello   world', 0, 1000);
        expect(words).toHaveLength(2);
        expect(words[0].word).toBe('hello');
        expect(words[1].word).toBe('world');
    });

    it('zero duration produces zero-duration words', () => {
        const words = textToWords('Hello world', 500, 500);
        expect(words).toHaveLength(2);
        expect(words[0].sourceStartTimeMs).toBe(500);
        expect(words[1].sourceEndTimeMs).toBe(500);
    });

    it('each word gets a unique id', () => {
        const words = textToWords('one two three', 0, 1000);
        const ids = words.map(w => w.id);
        expect(new Set(ids).size).toBe(3);
    });

    it('words have visible=false and zero output times', () => {
        const words = textToWords('hello', 0, 1000);
        expect(words[0].visible).toBe(false);
        expect(words[0].outputStartTimeMs).toBe(0);
        expect(words[0].outputEndTimeMs).toBe(0);
    });
});

// ==========================================
// getSegmentText
// ==========================================

describe('getSegmentText', () => {
    function makeSeg(words: { word: string; hidden?: boolean }[]): CaptionSegment {
        return {
            id: 'seg1',
            sourceStartTimeMs: 0,
            sourceEndTimeMs: 1000,
            outputStartTimeMs: 0,
            outputEndTimeMs: 1000,
            visible: true,
            words: words.map((w, i) => ({
                id: `w${i}`,
                word: w.word,
                hidden: w.hidden,
                sourceStartTimeMs: 0,
                sourceEndTimeMs: 0,
                outputStartTimeMs: 0,
                outputEndTimeMs: 0,
                visible: true,
            })),
        };
    }

    it('joins all words with spaces', () => {
        expect(getSegmentText(makeSeg([{ word: 'Hello' }, { word: 'world' }]))).toBe('Hello world');
    });

    it('includes hidden words by default', () => {
        expect(getSegmentText(makeSeg([{ word: 'Hello' }, { word: 'um', hidden: true }, { word: 'world' }]))).toBe('Hello um world');
    });

    it('excludes hidden words when visibleOnly=true', () => {
        expect(getSegmentText(makeSeg([{ word: 'Hello' }, { word: 'um', hidden: true }, { word: 'world' }]), true)).toBe('Hello world');
    });

    it('empty words returns empty string', () => {
        expect(getSegmentText(makeSeg([]))).toBe('');
    });
});
