import { describe, expect, it } from 'vitest';
import { formatDuration } from './formatDuration';

describe('formatDuration', () => {
    it.each([
        [0, '0:00'],
        [999, '0:00'],
        [7_000, '0:07'],
        [222_900, '3:42'],
        [600_000, '10:00'],
        [3_599_999, '59:59'],
        [3_600_000, '1:00:00'],
        [3_723_000, '1:02:03'],
        [-5_000, '0:00'],
    ])('%i ms → %s', (ms, expected) => {
        expect(formatDuration(ms)).toBe(expected);
    });
});
