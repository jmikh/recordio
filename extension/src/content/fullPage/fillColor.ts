/**
 * @fileoverview Background colours for canvas areas no tile paints (the
 * columns beside an expanded inner scroller). Read from the DOM rather than
 * sampled from pixels so a bottom-anchored widget never smears downward.
 */

import { isRecordioNode } from './domWalk';
import { composedParent } from './elementClassifier';

export function isTransparentColor(color: string): boolean {
    const c = color.trim().toLowerCase();
    if (!c || c === 'transparent') return true;
    const m = c.match(/^rgba?\(([^)]+)\)$/);
    if (!m) return false;
    const parts = m[1].split(/[\s,/]+/).filter(Boolean);
    return parts.length === 4 && parseFloat(parts[3]) === 0;
}

/** First non-transparent background-color walking up from `start` (inclusive). */
export function backgroundColorOf(start: Element | null): string | null {
    let node: Element | null = start;
    while (node) {
        const bg = getComputedStyle(node).backgroundColor;
        if (!isTransparentColor(bg)) return bg;
        if (node === document.documentElement) break;
        node = composedParent(node);
    }
    return null;
}

export function backgroundColorAt(x: number, y: number): string | null {
    const els = document.elementsFromPoint(x, y).filter((e) => !isRecordioNode(e));
    return backgroundColorOf(els[0] ?? null);
}

export function pageBackgroundColor(): string {
    return backgroundColorOf(document.body) ?? backgroundColorOf(document.documentElement) ?? '#ffffff';
}
