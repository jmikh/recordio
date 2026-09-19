/**
 * getOutputCaptions — pure unit tier (no db). Covers the mapping
 * contract the watch page relies on: output time after cuts/speed,
 * hidden words dropped, cut segments dropped, malformed data tolerated.
 */
import { describe, expect, it } from 'vitest';
import { getOutputCaptions } from '../src/services/projectCaptions.js';

function word(text: string, startMs: number, endMs: number, hidden = false) {
    return {
        id: `w-${text}-${startMs}`, word: text, hidden,
        sourceStartTimeMs: startMs, sourceEndTimeMs: endMs,
        outputStartTimeMs: 0, outputEndTimeMs: 0, visible: true,
    };
}

function segment(id: string, startMs: number, endMs: number, words: ReturnType<typeof word>[]) {
    return {
        id, words,
        sourceStartTimeMs: startMs, sourceEndTimeMs: endMs,
        // Deliberately stale cache: the service must recompute, not trust it
        outputStartTimeMs: 999_999, outputEndTimeMs: 999_999, visible: true,
    };
}

describe('getOutputCaptions', () => {
    it('maps source times to output time through cuts and speed', () => {
        // Window A [0,5000] at 1x → output [0,5000]; gap [5000,8000] cut;
        // Window B [8000,10000] at 2x → output [5000,6000]
        const outputWindows = [
            { id: 'a', startMs: 0, endMs: 5000, speed: 1 },
            { id: 'b', startMs: 8000, endMs: 10000, speed: 2 },
        ];
        const captionSegments = [
            segment('s1', 1000, 2000, [word('hello', 1000, 1500), word('world', 1500, 2000)]),
            segment('s2', 8000, 9000, [word('after', 8000, 8500), word('cut', 8500, 9000)]),
        ];

        expect(getOutputCaptions({ captionSegments, outputWindows })).toEqual([
            { text: 'hello world', startMs: 1000, endMs: 2000 },
            { text: 'after cut', startMs: 5000, endMs: 5500 },
        ]);
    });

    it('drops segments fully inside a cut and clips ones straddling it', () => {
        const outputWindows = [
            { id: 'a', startMs: 0, endMs: 5000, speed: 1 },
            { id: 'b', startMs: 8000, endMs: 10000, speed: 1 },
        ];
        const captionSegments = [
            segment('cut', 6000, 7000, [word('gone', 6000, 7000)]),
            segment('straddle', 4000, 9000, [word('kept', 4000, 9000)]),
        ];

        expect(getOutputCaptions({ captionSegments, outputWindows })).toEqual([
            // Visible portions: [4000,5000] → [4000,5000] and [8000,9000] → [5000,6000]
            { text: 'kept', startMs: 4000, endMs: 6000 },
        ]);
    });

    it('omits hidden words and drops lines that end up empty; sorts by start', () => {
        const outputWindows = [{ id: 'a', startMs: 0, endMs: 10_000, speed: 1 }];
        const captionSegments = [
            segment('late', 5000, 6000, [word('second', 5000, 6000)]),
            segment('early', 1000, 2000, [word('um', 1000, 1200, true), word('first', 1200, 2000)]),
            segment('empty', 3000, 4000, [word('shh', 3000, 4000, true)]),
        ];

        expect(getOutputCaptions({ captionSegments, outputWindows })).toEqual([
            { text: 'first', startMs: 1000, endMs: 2000 },
            { text: 'second', startMs: 5000, endMs: 6000 },
        ]);
    });

    it('returns [] for missing, empty, or malformed timeline data', () => {
        expect(getOutputCaptions(null)).toEqual([]);
        expect(getOutputCaptions(undefined)).toEqual([]);
        expect(getOutputCaptions({})).toEqual([]);
        expect(getOutputCaptions({ captionSegments: [], outputWindows: [{ id: 'a', startMs: 0, endMs: 1, speed: 1 }] })).toEqual([]);
        // Captions but no windows: nothing can be placed in output time
        expect(getOutputCaptions({ captionSegments: [segment('s', 0, 1, [word('x', 0, 1)])], outputWindows: [] })).toEqual([]);
        // Garbage entries are skipped rather than thrown on
        expect(getOutputCaptions({
            captionSegments: ['nope', { id: 'no-words', sourceStartTimeMs: 0, sourceEndTimeMs: 1 }, null],
            outputWindows: [{ id: 'a', startMs: 0, endMs: 1, speed: 1 }, 42],
        })).toEqual([]);
    });
});
