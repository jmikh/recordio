/** fuzzyMatch — the /admin user picker's scorer (plans/admin-user-impersonation-oneshot.md). */
import { describe, expect, it } from 'vitest';
import { fuzzyMatch } from './fuzzy';

describe('fuzzyMatch', () => {
    it('matches a subsequence and reports positions for highlighting', () => {
        const m = fuzzyMatch('jsm', 'john.smith@example.com');
        expect(m).not.toBeNull();
        expect(m!.positions).toEqual([0, 5, 6]);
    });

    it('is case-insensitive', () => {
        expect(fuzzyMatch('JSM', 'john.smith@example.com')).not.toBeNull();
        expect(fuzzyMatch('jsm', 'JOHN.SMITH@EXAMPLE.COM')).not.toBeNull();
    });

    it('null when the query is not a subsequence', () => {
        expect(fuzzyMatch('xyz', 'john.smith@example.com')).toBeNull();
        expect(fuzzyMatch('mj', 'jm')).toBeNull();
    });

    it('empty query matches with zero score', () => {
        expect(fuzzyMatch('', 'anything')).toEqual({ score: 0, positions: [] });
    });

    it('ranks boundary/consecutive matches above scattered ones', () => {
        const tight = fuzzyMatch('smith', 'anna.smith@x.com')!;
        const scattered = fuzzyMatch('smith', 'sam.mitchell.h@x.com')!;
        expect(tight.score).toBeGreaterThan(scattered.score);
    });

    it('prefers a word-boundary match over a mid-word one', () => {
        const boundary = fuzzyMatch('smith', 'smith@x.com')!;
        const midWord = fuzzyMatch('smith', 'blacksmith@x.com')!;
        expect(boundary.score).toBeGreaterThan(midWord.score);
    });
});
