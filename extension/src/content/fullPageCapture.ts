/**
 * @fileoverview Full-page capture — page side (plans/full-page-capture-oneshot.md).
 *
 * The background drives a tiled captureVisibleTab loop over "strips": the
 * window, then up to MAX_INNER_SCROLLERS inner scrollers, then a footer pass.
 * This class does everything that needs the DOM:
 *
 *   prepare()   session styles (scrollbars, transitions, scroll anchoring),
 *               lazy images eager + pre-scroll, classify positioned elements
 *               (sticky → relative for the whole session; the fixed header
 *               band height), find inner scrollers, sample fill colours,
 *               arm Escape.
 *   scrollTo()  scroll the window and/or a strip element, re-walk for
 *               elements that appeared, apply this tile's hide state, settle,
 *               report actual positions and the strip's box.
 *   waitForGrowth()  at the bottom of a strip: sit still until lazy loaders /
 *               infinite feeds stop extending the content (bounded), so the
 *               background can extend the plan instead of stopping early.
 *   finish()    restore everything, idempotent — the background always
 *               sends it, also on error/cancel, and Escape calls it directly.
 *
 * Nothing is drawn on the page: progress lives in the extension popup, which
 * stays open for the whole capture (the popup is not part of the tab, so it
 * never lands in a captureVisibleTab).
 *
 * Only `opacity: 0` ever hides anything: it composites the subtree and no
 * descendant rule can undo it (`visibility` is inherited and pages override
 * it — Reddit's header avatar leaked through exactly that way).
 */

import type { Rect } from '@shared/types';
import {
    MSG_TYPES,
    type FullPageFill,
    type FullPagePrepareResult,
    type FullPageScrollToPayload,
    type FullPageScrollToResult,
    type FullPageStripInfo,
    type FullPageWaitForGrowthPayload,
    type FullPageWaitForGrowthResult,
} from '../shared/messageTypes';
import { MAX_INNER_SCROLLERS, effectiveHeaderHeight, overlapFor } from '../shared/fullPagePlan';
import { afterRepaint, raf, settle, sleep } from './fullPage/captureTiming';
import { StyleStack } from './fullPage/styleStack';
import { walkComposed } from './fullPage/domWalk';
import { classifyElement, type ElementClass } from './fullPage/elementClassifier';
import { findInnerScrollers } from './fullPage/scrollerFinder';
import { backgroundColorAt, pageBackgroundColor } from './fullPage/fillColor';

const STYLE_ID = 'recordio-fullpage-styles';
/** Pre-scroll pass cap — enough to wake lazy loaders on very long pages without taking seconds */
const MAX_PRESCROLL_STEPS = 40;
/** Per-tile walk budget (Reddit: tens of thousands of nodes across ~1 700 shadow roots) */
const MAX_WALK_NODES = 40000;
const MAX_WALK_MS = 250;
/**
 * Pause after each scroll before the tile is captured, so scroll-driven
 * loaders (lazy images, feed pagination) have rendered. Largely free: the
 * background spaces captureVisibleTab calls ≥510 ms apart anyway, so most
 * of this overlaps that wait instead of adding to it.
 */
const SETTLE_MS = 400;
/** waitForGrowth: poll interval and total budget per strip bottom */
const GROWTH_POLL_MS = 200;
const GROWTH_MAX_WAIT_MS = 1500;
/** Absolutely-positioned overlays pinned to a strip's frame smaller than this are hidden */
const INNER_ABSOLUTE_MAX_AREA = 5000;

type Styleable = Element & ElementCSSInlineStyle;

function isStyleable(el: Element): el is Styleable {
    return 'style' in el && (el as Styleable).style instanceof CSSStyleDeclaration;
}

function clamp(v: number, lo: number, hi: number): number {
    return Math.max(lo, Math.min(hi, v));
}

function clampToViewport(r: DOMRect, vw: number, vh: number): Rect {
    const x0 = Math.max(0, r.left);
    const y0 = Math.max(0, r.top);
    const x1 = Math.min(vw, r.right);
    const y1 = Math.min(vh, r.bottom);
    return { x: x0, y: y0, width: Math.max(0, x1 - x0), height: Math.max(0, y1 - y0) };
}

export class FullPageSession {
    private active = false;
    private cancelled = false;
    private styleEl: HTMLStyleElement | null = null;
    /** Session-long changes (sticky → relative, background-attachment, strip scroll behaviour) */
    private readonly styles = new StyleStack();
    /** This tile's hides; reset at the start of every tile */
    private readonly tileStyles = new StyleStack();
    private classes = new WeakMap<Element, ElementClass>();
    private headers: Styleable[] = [];
    private fixedOther: Styleable[] = [];
    private bottomFixed: Styleable[] = [];
    private strips: HTMLElement[] = [];
    private stripOriginalScrollTops: number[] = [];
    private lazyImages: Array<{ el: HTMLImageElement; prev: string | null }> = [];
    private originalScroll = { x: 0, y: 0 };
    private viewport = { width: 0, height: 0 };
    private headerHeight = 0;
    private walkBudgetHit = false;
    private readonly onKeyDown = (e: KeyboardEvent) => {
        if (e.key !== 'Escape') return;
        e.preventDefault();
        e.stopPropagation();
        this.cancelled = true;
        chrome.runtime.sendMessage({ type: MSG_TYPES.CONTENT_SCREENSHOT_CANCELLED }).catch(() => {});
        this.finish();
    };

    constructor(private readonly beforePrepare: () => void) {}

    async prepare(): Promise<FullPagePrepareResult> {
        if (this.active) this.finish();
        this.beforePrepare();
        this.cancelled = false;
        this.active = true;
        this.classes = new WeakMap();
        this.headers = [];
        this.fixedOther = [];
        this.bottomFixed = [];
        this.walkBudgetHit = false;
        this.originalScroll = { x: window.scrollX, y: window.scrollY };

        this.injectSessionStyles();
        await raf(); // scrollbar removal changes client sizes — measure after a frame
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        this.viewport = { width: vw, height: vh };

        // Lazy content: eager attributes + one quick pass through the page so
        // IntersectionObserver-based loaders and infinite-scroll feeds run now.
        for (const img of Array.from(document.querySelectorAll<HTMLImageElement>('img[loading="lazy"]'))) {
            this.lazyImages.push({ el: img, prev: img.getAttribute('loading') });
            img.setAttribute('loading', 'eager');
        }
        const scroller = document.scrollingElement ?? document.documentElement;
        let steps = 0;
        for (let y = 0; y < scroller.scrollHeight && steps < MAX_PRESCROLL_STEPS; y += vh, steps++) {
            window.scrollTo(this.originalScroll.x, y);
            await raf();
        }
        window.scrollTo(this.originalScroll.x, 0);
        await settle(100);

        const scrollable = scroller.scrollHeight - vh >= 8;
        const maxY = Math.max(0, scroller.scrollHeight - vh);

        // Classify at scroll 0: sticky → relative from here on (so every later
        // measurement sees natural positions); the fixed header band is decided once.
        this.walkBudgetHit = this.classifyAll(true).budgetHit;
        const rawHeader = this.headers.reduce((max, el) => Math.max(max, el.getBoundingClientRect().bottom), 0);
        this.headerHeight = effectiveHeaderHeight(Math.ceil(rawHeader), vh, overlapFor(window.devicePixelRatio));
        if (this.headerHeight === 0 && this.headers.length) {
            this.fixedOther.push(...this.headers);
            this.headers = [];
        }
        await raf();

        // Inner scrollers (after relativizing, at scroll 0), pre-scrolled so their lazy content loads
        const found = findInnerScrollers({ vh, maxY, max: MAX_INNER_SCROLLERS, maxNodes: MAX_WALK_NODES });
        this.walkBudgetHit ||= found.budgetHit;
        this.strips = found.scrollers.map((s) => s.el);
        this.stripOriginalScrollTops = this.strips.map((el) => el.scrollTop);
        for (const el of this.strips) {
            this.styles.set(el, 'scroll-behavior', 'auto');
            this.styles.set(el, 'scroll-snap-type', 'none');
            this.styles.set(el, 'overflow-anchor', 'none');
            let n = 0;
            for (let t = 0; t < el.scrollHeight && n < MAX_PRESCROLL_STEPS; t += Math.max(1, el.clientHeight), n++) {
                el.scrollTop = t;
                await raf();
            }
            el.scrollTop = 0;
        }
        if (this.strips.length) {
            window.scrollTo(this.originalScroll.x, 0);
            await settle(100);
        }

        const strips: FullPageStripInfo[] = this.strips.map((el, index) => {
            const r = el.getBoundingClientRect();
            const boxTop = r.top + window.scrollY;
            const insideColor = backgroundColorAt(r.left + r.width / 2, clamp(r.bottom - 1, 0, vh - 1));
            return {
                index,
                box: { x: r.left, y: boxTop, width: r.width, height: r.height },
                scrollHeight: el.scrollHeight,
                clientHeight: el.clientHeight,
                windowY: clamp(boxTop, 0, maxY),
                ...(insideColor ? { insideColor } : {}),
            };
        });

        document.addEventListener('keydown', this.onKeyDown, true);

        return {
            viewportWidth: vw,
            viewportHeight: vh,
            devicePixelRatio: window.devicePixelRatio,
            scrollX: this.originalScroll.x,
            document: { scrollWidth: scroller.scrollWidth, scrollHeight: scroller.scrollHeight, scrollable },
            headerHeight: this.headerHeight,
            strips,
            pageBackground: pageBackgroundColor(),
            fills: columnFills(strips, vw, vh),
            hasBottomFixed: this.bottomFixed.length > 0,
            pinchZoomed: (window.visualViewport?.scale ?? 1) !== 1,
            walkBudgetHit: this.walkBudgetHit,
        };
    }

    async scrollTo(p: FullPageScrollToPayload): Promise<FullPageScrollToResult> {
        const scroller = document.scrollingElement ?? document.documentElement;
        const bail = (): FullPageScrollToResult => ({ cancelled: true, scrollY: window.scrollY, documentHeight: scroller.scrollHeight });
        if (!this.active || this.cancelled) return bail();

        await this.scrollWindowTo(p.windowY);
        const stripEl = p.strip >= 0 ? this.strips[p.strip] ?? null : null;
        if (stripEl && p.scrollTop !== undefined) await this.scrollElementTo(stripEl, p.scrollTop);

        // Elements that appeared after scrolling ("back to top", loading bars) get classified now
        this.classifyAll(false);
        this.applyTileState(p, stripEl);

        await settle(SETTLE_MS);
        if (this.cancelled) return bail();
        await afterRepaint(); // the opacity hides above must be composited before the capture
        if (this.cancelled) return bail();

        const { width: vw, height: vh } = this.viewport;
        const result: FullPageScrollToResult = { cancelled: false, scrollY: window.scrollY, documentHeight: scroller.scrollHeight };
        if (stripEl) {
            result.scrollTop = stripEl.scrollTop;
            result.stripScrollHeight = stripEl.scrollHeight;
            result.box = clampToViewport(stripEl.getBoundingClientRect(), vw, vh);
        }
        if (p.phase === 'footer') {
            result.footerRects = this.bottomFixed
                .map((el) => clampToViewport(el.getBoundingClientRect(), vw, vh))
                .filter((r) => r.width > 0 && r.height > 0);
        }
        return result;
    }

    /**
     * Called when the background has reached the bottom of the planned
     * content. Polls the scroll height until two consecutive reads agree (the
     * loader is done) or the budget runs out (still growing — the caller
     * decides whether to keep going, bounded by MAX_PAGE_HEIGHT_CSS).
     */
    async waitForGrowth(p: FullPageWaitForGrowthPayload): Promise<FullPageWaitForGrowthResult> {
        const scroller = document.scrollingElement ?? document.documentElement;
        const stripEl = p.strip >= 0 ? this.strips[p.strip] ?? null : null;
        const measure = () => (stripEl ?? scroller).scrollHeight;
        const result = (stillGrowing: boolean): FullPageWaitForGrowthResult => ({
            cancelled: !this.active || this.cancelled,
            documentHeight: scroller.scrollHeight,
            ...(stripEl ? { stripScrollHeight: stripEl.scrollHeight } : {}),
            stillGrowing,
        });
        if (!this.active || this.cancelled) return result(false);

        let last = measure();
        const deadline = Date.now() + GROWTH_MAX_WAIT_MS;
        while (Date.now() < deadline) {
            await sleep(GROWTH_POLL_MS);
            if (this.cancelled) return result(false);
            const next = measure();
            if (next === last) return result(false);
            last = next;
        }
        return result(true);
    }

    finish(): void {
        if (!this.active) return;
        this.active = false;
        document.removeEventListener('keydown', this.onKeyDown, true);

        this.tileStyles.restoreAll();
        this.styles.restoreAll();

        for (const { el, prev } of this.lazyImages) {
            if (prev === null) el.removeAttribute('loading');
            else el.setAttribute('loading', prev);
        }
        this.lazyImages = [];

        this.strips.forEach((el, i) => { el.scrollTop = this.stripOriginalScrollTops[i] ?? 0; });
        this.strips = [];
        this.stripOriginalScrollTops = [];
        this.headers = [];
        this.fixedOther = [];
        this.bottomFixed = [];
        this.classes = new WeakMap();

        this.styleEl?.remove();
        this.styleEl = null;

        window.scrollTo({ left: this.originalScroll.x, top: this.originalScroll.y, behavior: 'instant' as ScrollBehavior });
    }

    // ── helpers ────────────────────────────────────────────────────────────

    private injectSessionStyles(): void {
        document.getElementById(STYLE_ID)?.remove();
        const style = document.createElement('style');
        style.id = STYLE_ID;
        // Pause (never remove) animations: `animation: none` would snap
        // fill-mode fade-ins back to their invisible first frame.
        style.textContent = `
            *::-webkit-scrollbar { display: none !important; }
            * { scrollbar-width: none !important; }
            *:not([data-recordio]):not([data-recordio] *) { transition: none !important; animation-play-state: paused !important; }
            html, body { scroll-behavior: auto !important; overflow-anchor: none !important; scroll-snap-type: none !important; }
        `;
        document.head.appendChild(style);
        this.styleEl = style;
    }

    /** Walks the page, classifies elements not seen before, applies session-long changes. */
    private classifyAll(allowHeader: boolean): { budgetHit: boolean } {
        const { width: vw, height: vh } = this.viewport;
        const result = walkComposed(document.body, (el) => {
            if (this.classes.has(el) || !isStyleable(el)) return;
            const cs = getComputedStyle(el);
            if (cs.backgroundAttachment === 'fixed') this.styles.set(el, 'background-attachment', 'scroll');
            let cls = classifyElement(el, cs, vw, vh);
            if (cls === 'header' && !allowHeader) cls = 'fixedOther';
            this.classes.set(el, cls);
            switch (cls) {
                case 'sticky':
                    this.styles.set(el, 'position', 'relative');
                    for (const prop of ['top', 'left', 'right', 'bottom']) this.styles.set(el, prop, 'auto');
                    this.styles.set(el, 'transition', 'none');
                    break;
                case 'header': this.headers.push(el); break;
                case 'bottomFixed': this.bottomFixed.push(el); break;
                case 'fixedOther': this.fixedOther.push(el); break;
                default: break;
            }
        }, { maxNodes: MAX_WALK_NODES, maxMs: MAX_WALK_MS });
        return { budgetHit: result.budgetHit };
    }

    /**
     * Tile state, from a clean slate each time: the header and other fixed
     * elements show on the very first tile only; bottom-anchored ones only in
     * the footer pass; overlays pinned to a strip's frame are hidden while
     * that strip is tiled.
     */
    private applyTileState(p: FullPageScrollToPayload, stripEl: HTMLElement | null): void {
        this.tileStyles.restoreAll();
        const hide = (els: Styleable[]) => { for (const el of els) this.tileStyles.set(el, 'opacity', '0'); };

        if (p.phase === 'footer') {
            hide(this.headers);
            hide(this.fixedOther);
        } else {
            const firstTile = p.strip === -1 && p.tileIndex === 0;
            if (!firstTile) {
                hide(this.headers);
                hide(this.fixedOther);
            }
            hide(this.bottomFixed);
        }

        if (stripEl) {
            walkComposed(stripEl, (el) => {
                if (!isStyleable(el) || getComputedStyle(el).position !== 'absolute') return;
                const offsetParent = (el as HTMLElement).offsetParent;
                if (offsetParent && stripEl.contains(offsetParent)) return;
                const r = el.getBoundingClientRect();
                if (r.width * r.height < INNER_ABSOLUTE_MAX_AREA) this.tileStyles.set(el, 'opacity', '0');
            }, { maxNodes: 5000, maxMs: 50 });
        }

        this.styles.reassert();
    }

    private async scrollWindowTo(y: number): Promise<void> {
        const x = this.originalScroll.x;
        window.scrollTo({ left: x, top: y, behavior: 'instant' as ScrollBehavior });
        if (Math.abs(window.scrollY - y) > 1) {
            await sleep(50);
            window.scrollTo({ left: x, top: y, behavior: 'instant' as ScrollBehavior });
        }
    }

    private async scrollElementTo(el: HTMLElement, top: number): Promise<void> {
        el.scrollTop = top;
        if (Math.abs(el.scrollTop - top) > 1) {
            await sleep(50);
            el.scrollTop = top;
        }
    }
}

/** Background colour per column beside/between the strips, sampled at the viewport's bottom row. */
function columnFills(strips: FullPageStripInfo[], vw: number, vh: number): FullPageFill[] {
    const sorted = [...strips].sort((a, b) => a.box.x - b.box.x);
    const fills: FullPageFill[] = [];
    let x = 0;
    for (const st of sorted) {
        pushFill(fills, x, st.box.x, vh);
        x = Math.max(x, st.box.x + st.box.width);
    }
    pushFill(fills, x, vw, vh);
    return fills;
}

function pushFill(fills: FullPageFill[], x0: number, x1: number, vh: number): void {
    if (x1 - x0 <= 2) return;
    const color = backgroundColorAt((x0 + x1) / 2, vh - 1) ?? pageBackgroundColor();
    fills.push({ x0, x1, color });
}
