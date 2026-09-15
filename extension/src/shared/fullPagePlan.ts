/**
 * @fileoverview Full-page capture planning — pure math shared by the content
 * script (fixed-element classification) and the background stitcher (tile
 * targets, canvas layout, draw ops). No DOM, no chrome.* — unit-tested in
 * fullPagePlan.test.ts. Design: plans/full-page-capture-oneshot.md.
 *
 * Units: "css" = page CSS px (viewport x, document y unless stated),
 * "device" = captured-bitmap px (css × scale), "canvas" = device × s.
 */

import type { Rect } from '@shared/types';

/** Tile cap across every strip plus the footer pass (~25 s at 2 captures/s) */
export const MAX_TILES = 50;
/** Chrome's per-side canvas limit */
export const MAX_DIM = 32767;
/** ≈320 MB RGBA transient in the service worker — revert to 64e6 if Sentry shows OOMs */
export const MAX_PIXELS = 80e6;
export const MAX_INNER_SCROLLERS = 3;
/**
 * Hard ceiling on how much of a document / inner scroller is captured (css px).
 * Growth found at the bottom of a strip is adopted up to this height, so an
 * infinite feed still terminates. Beyond ~14 000 css px a 2× page is already
 * being downscaled by MAX_PIXELS, so more rows buy nothing.
 */
export const MAX_PAGE_HEIGHT_CSS = 20000;

/** How close to the viewport edge a fixed element must sit to count as a header / bottom bar */
const EDGE_PX = 20;

// ============================================================================
// Fixed-element classification (rect only; the DOM part lives in the content script)
// ============================================================================

export type FixedClass = 'skip' | 'header' | 'bottomFixed' | 'fixedOther';

/** Rect in viewport css px. */
export function classifyFixedRect(rect: Rect, vw: number, vh: number): FixedClass {
    if (rect.width <= 0 || rect.height <= 0) return 'skip';
    if (rect.x + rect.width <= 0 || rect.y + rect.height <= 0 || rect.x >= vw || rect.y >= vh) return 'skip';
    // Modal / backdrop: leave it alone, the user sees what is on screen
    if (rect.height >= vh - EDGE_PX && rect.width >= (2 * vw) / 3) return 'skip';
    if (rect.y < EDGE_PX && rect.height < vh - EDGE_PX && rect.width >= vw / 2) return 'header';
    if (rect.y + rect.height >= vh - EDGE_PX && rect.y > EDGE_PX) return 'bottomFixed';
    return 'fixedOther';
}

// ============================================================================
// Tile targets
// ============================================================================

/** Consecutive tiles overlap by this many css px so integer rounding never leaves a seam. */
export function overlapFor(devicePixelRatio: number): number {
    return Math.max(1, Math.ceil(devicePixelRatio));
}

/** A header band that leaves less than a third of the viewport per tile is not a header. */
export function effectiveHeaderHeight(headerH: number, vh: number, overlap: number): number {
    if (headerH <= 0) return 0;
    return vh - headerH - overlap < vh / 3 ? 0 : headerH;
}

export function tileStep(viewportH: number, headerH: number, overlap: number): number {
    return Math.max(1, viewportH - headerH - overlap);
}

/** Static plan: 0, then +step, the last one clamped to the bottom exactly once. */
export function planTileYs(totalH: number, viewportH: number, headerH: number, overlap: number): number[] {
    const maxY = Math.max(0, totalH - viewportH);
    const step = tileStep(viewportH, headerH, overlap);
    const ys = [0];
    while (ys[ys.length - 1] < maxY) ys.push(Math.min(ys[ys.length - 1] + step, maxY));
    return ys;
}

/** The target after a tile actually landed at `prevActualY` (absorbs browser clamping and reflow). */
export function nextTileY(prevActualY: number, viewportH: number, headerH: number, overlap: number, maxY: number): number {
    return Math.min(prevActualY + tileStep(viewportH, headerH, overlap), Math.max(0, maxY));
}

export interface TileBudget {
    window: number;
    strips: number[];
    footer: boolean;
    truncated: boolean;
}

/** Window first, then strips in order, footer reserved up front. */
export function allocateTileBudget(windowTiles: number, stripTiles: number[], footer: boolean, max = MAX_TILES): TileBudget {
    let remaining = Math.max(0, max - (footer ? 1 : 0));
    let truncated = false;
    const window = Math.min(windowTiles, remaining);
    if (window < windowTiles) truncated = true;
    remaining -= window;
    const strips = stripTiles.map((n) => {
        const k = Math.min(n, remaining);
        if (k < n) truncated = true;
        remaining -= k;
        return k;
    });
    return { window, strips, footer, truncated };
}

// ============================================================================
// Canvas size
// ============================================================================

export interface Downscale {
    s: number;
    width: number;
    height: number;
    downscaled: boolean;
}

export function computeDownscale(fullW: number, fullH: number): Downscale {
    const w = Math.max(1, fullW);
    const h = Math.max(1, fullH);
    const s = Math.min(1, MAX_DIM / w, MAX_DIM / h, Math.sqrt(MAX_PIXELS / (w * h)));
    return {
        s,
        width: Math.max(1, Math.round(w * s)),
        height: Math.max(1, Math.round(h * s)),
        downscaled: s < 1,
    };
}

// ============================================================================
// Canvas layout (strips own regions; fills cover what no tile paints)
// ============================================================================

export interface StripLike {
    index: number;
    /** css: viewport x, document y (natural position, window scroll 0) */
    box: Rect;
    scrollHeight: number;
    clientHeight: number;
    insideColor?: string;
}

export interface ColumnFill {
    x0: number;
    x1: number;
    color: string;
}

export interface LayoutInput {
    viewportWidth: number;
    viewportHeight: number;
    document: { scrollHeight: number; scrollable: boolean };
    strips: StripLike[];
    pageBackground: string;
    fills: ColumnFill[];
}

export interface CanvasLayout {
    heightCss: number;
    /** Rows the window tiles cover: the document, or one viewport when it doesn't scroll */
    baseHeightCss: number;
    /** No scrolling document + at least one strip: side columns are filled, tails relocated */
    gmailMode: boolean;
    /** Per strip (same order): the column window tiles must never paint into */
    owned: Rect[];
    fills: Array<{ rect: Rect; color: string }>;
    /** Rows below a strip's box in its tile-0 capture, moved under the expanded content */
    tails: Array<{ strip: number; src: Rect; dstY: number }>;
}

const MIN_TAIL_PX = 4;

export function computeCanvasLayout(input: LayoutInput): CanvasLayout {
    const vh = input.viewportHeight;
    const baseHeightCss = input.document.scrollable ? input.document.scrollHeight : vh;
    const gmailMode = !input.document.scrollable && input.strips.length > 0;

    let heightCss = baseHeightCss;
    const owned: Rect[] = [];
    const tails: CanvasLayout['tails'] = [];
    const stripBottoms: number[] = [];

    for (const st of input.strips) {
        const boxBottom = st.box.y + st.box.height;
        const tailH = gmailMode ? Math.max(0, vh - boxBottom) : 0;
        const contentBottom = st.box.y + st.scrollHeight;
        const hasTail = tailH > MIN_TAIL_PX;
        const bottom = contentBottom + (hasTail ? tailH : 0);
        heightCss = Math.max(heightCss, bottom);
        owned.push({ x: st.box.x, y: st.box.y, width: st.box.width, height: st.scrollHeight });
        if (hasTail) tails.push({ strip: st.index, src: { x: st.box.x, y: boxBottom, width: st.box.width, height: tailH }, dstY: contentBottom });
        stripBottoms.push(bottom);
    }

    const fills: CanvasLayout['fills'] = [];
    if (heightCss > baseHeightCss) {
        for (const f of input.fills) {
            if (f.x1 - f.x0 <= 0) continue;
            fills.push({ rect: { x: f.x0, y: baseHeightCss, width: f.x1 - f.x0, height: heightCss - baseHeightCss }, color: f.color });
        }
    }
    input.strips.forEach((st, i) => {
        const bottom = stripBottoms[i];
        if (bottom < heightCss) {
            fills.push({ rect: { x: st.box.x, y: bottom, width: st.box.width, height: heightCss - bottom }, color: st.insideColor ?? input.pageBackground });
        }
    });

    return { heightCss, baseHeightCss, gmailMode, owned, fills, tails };
}

// ============================================================================
// Draw ops (device px on the bitmap → canvas px)
// ============================================================================

export interface DrawOp {
    /** Source rect on the captured bitmap (device px) */
    src: Rect;
    /** Destination rect on the canvas (canvas px) */
    dst: Rect;
    /** Canvas-px rects inside `dst` that must stay untouched (strip-owned regions) */
    clipOut?: Rect[];
}

export function scaleRect(r: Rect, f: number): Rect {
    return { x: Math.round(r.x * f), y: Math.round(r.y * f), width: Math.round(r.width * f), height: Math.round(r.height * f) };
}

export function intersectRect(a: Rect, b: Rect): Rect | null {
    const x0 = Math.max(a.x, b.x);
    const y0 = Math.max(a.y, b.y);
    const x1 = Math.min(a.x + a.width, b.x + b.width);
    const y1 = Math.min(a.y + a.height, b.y + b.height);
    if (x1 <= x0 || y1 <= y0) return null;
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/**
 * A window tile: the whole bitmap, minus the header band on tiles ≥ 1 (the
 * step already skipped that band, so nothing is lost), minus strip-owned
 * regions. Clip-outs are intersected with `dst` FIRST — a clip rect that
 * pokes outside the tile flips even-odd parity and becomes included.
 */
export function windowTileOp(p: {
    tileIndex: number;
    scrollY: number;
    headerH: number;
    bitmapW: number;
    bitmapH: number;
    scale: number;
    s: number;
    owned: Rect[];
}): DrawOp {
    const band = p.tileIndex === 0 ? 0 : p.headerH;
    const srcY = Math.min(p.bitmapH - 1, Math.max(0, Math.round(band * p.scale)));
    const src: Rect = { x: 0, y: srcY, width: p.bitmapW, height: p.bitmapH - srcY };
    const k = p.scale * p.s;
    const dst: Rect = {
        x: 0,
        y: Math.round((p.scrollY + band) * k),
        width: Math.round(p.bitmapW * p.s),
        height: Math.round(src.height * p.s),
    };
    const clipOut = p.owned
        .map((r) => intersectRect(scaleRect(r, k), dst))
        .filter((r): r is Rect => r !== null);
    return clipOut.length ? { src, dst, clipOut } : { src, dst };
}

/** A strip tile: the element's on-screen box, placed at its document position plus its own scroll. */
export function stripTileOp(p: { box: Rect; scrollY: number; scrollTop: number; scale: number; s: number }): DrawOp {
    const k = p.scale * p.s;
    return {
        src: scaleRect(p.box, p.scale),
        dst: {
            x: Math.round(p.box.x * k),
            y: Math.round((p.box.y + p.scrollY + p.scrollTop) * k),
            width: Math.round(p.box.width * k),
            height: Math.round(p.box.height * k),
        },
    };
}

/** Any viewport rect copied to a document position (strip tails, footer elements). */
export function viewportRectOp(p: { rect: Rect; dstXCss: number; dstYCss: number; scale: number; s: number }): DrawOp {
    const k = p.scale * p.s;
    return {
        src: scaleRect(p.rect, p.scale),
        dst: {
            x: Math.round(p.dstXCss * k),
            y: Math.round(p.dstYCss * k),
            width: Math.round(p.rect.width * k),
            height: Math.round(p.rect.height * k),
        },
    };
}

/** A bottom-anchored fixed element, kept at the same distance from the bottom of the canvas. */
export function footerOp(p: { rect: Rect; vh: number; canvasHeightPx: number; scale: number; s: number }): DrawOp {
    const k = p.scale * p.s;
    return {
        src: scaleRect(p.rect, p.scale),
        dst: {
            x: Math.round(p.rect.x * k),
            y: p.canvasHeightPx - Math.round((p.vh - p.rect.y) * k),
            width: Math.round(p.rect.width * k),
            height: Math.round(p.rect.height * k),
        },
    };
}
