/**
 * @fileoverview Inner scrollers worth tiling (Gmail's thread list, Reddit's rails).
 *
 * A candidate scrolls vertically by a meaningful amount, is big enough to
 * matter, and its whole box can be brought on screen by scrolling the window
 * to `windowY` — the strip is captured by scrolling the ELEMENT while the
 * window sits there, so a box that can't be fully shown can't be tiled.
 * `body` may qualify (html{overflow:hidden} body{overflow:auto} layouts);
 * only the root element is excluded. A match is not descended into.
 */

import type { Rect } from '@shared/types';
import { walkComposed } from './domWalk';

export interface InnerScroller {
    el: HTMLElement;
    /** css: viewport x, document y (window scroll 0) */
    box: Rect;
    scrollHeight: number;
    clientHeight: number;
    /** Window scrollY that shows the whole box */
    windowY: number;
}

const MIN_SCROLL_RANGE_PX = 40;
const MIN_HEIGHT_PX = 50;
const MIN_WIDTH_PX = 40;
const EDGE_TOLERANCE_PX = 2;

function clamp(v: number, lo: number, hi: number): number {
    return Math.max(lo, Math.min(hi, v));
}

export function findInnerScrollers(opts: { vh: number; maxY: number; max: number; maxNodes?: number }): { scrollers: InnerScroller[]; budgetHit: boolean } {
    const found: InnerScroller[] = [];
    const result = walkComposed(document.documentElement, (el) => {
        if (el === document.head) return false;
        if (!(el instanceof HTMLElement)) return;
        const cs = getComputedStyle(el);
        const overflowY = cs.overflowY;
        if (overflowY !== 'auto' && overflowY !== 'scroll' && overflowY !== 'overlay') return;
        if (el.scrollHeight <= el.clientHeight + MIN_SCROLL_RANGE_PX) return;
        if (el.clientHeight <= MIN_HEIGHT_PX || el.clientWidth <= MIN_WIDTH_PX) return;
        if (cs.pointerEvents === 'none') return;

        const r = el.getBoundingClientRect();
        const boxTop = r.top + window.scrollY;
        const windowY = clamp(boxTop, 0, opts.maxY);
        const topOnScreen = boxTop - windowY;
        // Can't be shown whole → keep descending, a child may qualify
        if (topOnScreen < -EDGE_TOLERANCE_PX || topOnScreen + r.height > opts.vh + EDGE_TOLERANCE_PX) return;

        found.push({
            el,
            box: { x: r.left, y: boxTop, width: r.width, height: r.height },
            scrollHeight: el.scrollHeight,
            clientHeight: el.clientHeight,
            windowY,
        });
        return false;
    }, { maxNodes: opts.maxNodes });

    found.sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight));
    return { scrollers: found.slice(0, opts.max), budgetHit: result.budgetHit };
}
