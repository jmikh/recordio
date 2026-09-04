/**
 * Tiny fuzzy matcher for the /admin user picker
 * (plans/admin-user-impersonation-oneshot.md): greedy left-to-right
 * subsequence match with boundary/adjacency bonuses — `jsm` matches
 * `john.smith@…`. Pure and dependency-free so it's unit-testable.
 */

export interface FuzzyMatch {
    score: number;
    /** Indices of the matched characters in the candidate text (for highlighting). */
    positions: number[];
}

const SEPARATORS = new Set([' ', '.', '@', '_', '-', '+']);

/** Case-insensitive subsequence match; null when query isn't a subsequence of text. */
export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
    const q = query.toLowerCase();
    const t = text.toLowerCase();
    if (!q) return { score: 0, positions: [] };

    const positions: number[] = [];
    let score = 0;
    let from = 0;
    for (const ch of q) {
        const idx = t.indexOf(ch, from);
        if (idx === -1) return null;
        score += 1;
        // Word-boundary bonus (start of text or after a separator)
        if (idx === 0 || SEPARATORS.has(t[idx - 1])) score += 2;
        // Consecutive-run bonus
        if (positions.length > 0 && idx === positions[positions.length - 1] + 1) score += 2;
        positions.push(idx);
        from = idx + 1;
    }
    // Prefer tight matches: fractional penalty for the span the match stretches over
    score -= (positions[positions.length - 1] - positions[0]) / t.length;
    return { score, positions };
}
