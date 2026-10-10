import { describe, expect, it } from 'vitest';
import { getOutputDurationMs, getOutputWindows } from '../src/services/projectTimeline.js';

describe('getOutputWindows', () => {
    it('keeps well-formed windows and drops malformed ones', () => {
        const windows = getOutputWindows({
            outputWindows: [
                { id: 'a', startMs: 0, endMs: 1000 },
                null,
                { id: 'b', startMs: '5', endMs: 6000 },
                { id: 'c', startMs: 2000, endMs: 3000 },
            ],
        });
        expect(windows.map((w) => w.id)).toEqual(['a', 'c']);
    });

    it.each([null, undefined, {}, { outputWindows: 'nope' }])('is empty for %j', (timeline) => {
        expect(getOutputWindows(timeline as never)).toEqual([]);
    });
});

describe('getOutputDurationMs', () => {
    it('sums the windows with speed applied, rounded to the ms', () => {
        expect(getOutputDurationMs({
            outputWindows: [
                { id: 'a', startMs: 0, endMs: 200_000 },
                { id: 'b', startMs: 300_000, endMs: 345_801, speed: 2 },
            ],
        })).toBe(222_901);
    });

    it('is undefined when there are no usable windows', () => {
        expect(getOutputDurationMs({ outputWindows: [] })).toBeUndefined();
        expect(getOutputDurationMs(null)).toBeUndefined();
    });
});
