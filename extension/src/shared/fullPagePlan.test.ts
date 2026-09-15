import { describe, expect, it } from 'vitest';
import {
    MAX_DIM,
    MAX_PIXELS,
    allocateTileBudget,
    classifyFixedRect,
    computeCanvasLayout,
    computeDownscale,
    effectiveHeaderHeight,
    footerOp,
    intersectRect,
    nextTileY,
    overlapFor,
    planTileYs,
    stripTileOp,
    tileStep,
    viewportRectOp,
    windowTileOp,
} from './fullPagePlan';

const VW = 1440;
const VH = 900;

/** Deterministic pseudo-random for the property tests. */
function lcg(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 0x100000000;
    };
}

describe('classifyFixedRect', () => {
    it('full-width bar at the top is a header', () => {
        expect(classifyFixedRect({ x: 0, y: 0, width: VW, height: 56 }, VW, VH)).toBe('header');
    });
    it('a small top-left widget is not a header', () => {
        expect(classifyFixedRect({ x: 8, y: 8, width: 40, height: 40 }, VW, VH)).toBe('fixedOther');
    });
    it('bottom bar is bottomFixed', () => {
        expect(classifyFixedRect({ x: 0, y: VH - 60, width: VW, height: 60 }, VW, VH)).toBe('bottomFixed');
        expect(classifyFixedRect({ x: VW - 320, y: VH - 48, width: 300, height: 48 }, VW, VH)).toBe('bottomFixed');
    });
    it('viewport-sized backdrop is skipped', () => {
        expect(classifyFixedRect({ x: 0, y: 0, width: VW, height: VH }, VW, VH)).toBe('skip');
    });
    it('offscreen and empty rects are skipped', () => {
        expect(classifyFixedRect({ x: -500, y: 100, width: 400, height: 100 }, VW, VH)).toBe('skip');
        expect(classifyFixedRect({ x: 0, y: VH + 10, width: 400, height: 100 }, VW, VH)).toBe('skip');
        expect(classifyFixedRect({ x: 0, y: 0, width: 0, height: 0 }, VW, VH)).toBe('skip');
    });
    it('a floating side widget is fixedOther', () => {
        expect(classifyFixedRect({ x: VW - 80, y: 300, width: 60, height: 60 }, VW, VH)).toBe('fixedOther');
    });
});

describe('header band', () => {
    it('overlap is ceil(dpr), at least 1', () => {
        expect(overlapFor(1)).toBe(1);
        expect(overlapFor(1.25)).toBe(2);
        expect(overlapFor(2)).toBe(2);
        expect(overlapFor(0.5)).toBe(1);
    });
    it('rejects a header that leaves less than a third of the viewport', () => {
        expect(effectiveHeaderHeight(56, VH, 2)).toBe(56);
        expect(effectiveHeaderHeight(650, VH, 2)).toBe(0);
        expect(effectiveHeaderHeight(0, VH, 2)).toBe(0);
    });
});

describe('planTileYs', () => {
    it('one tile when the content fits', () => {
        expect(planTileYs(VH, VH, 0, 2)).toEqual([0]);
        expect(planTileYs(400, VH, 0, 2)).toEqual([0]);
    });
    it('steps by viewport − header − overlap and clamps the last tile once', () => {
        const ys = planTileYs(3000, VH, 56, 2);
        const step = tileStep(VH, 56, 2);
        expect(step).toBe(842);
        expect(ys).toEqual([0, 842, 1684, 2100]);
    });
    it('does not repeat the bottom when it lands exactly', () => {
        const ys = planTileYs(VH * 3, VH, 0, 0);
        expect(ys).toEqual([0, VH, VH * 2]);
    });
    it('property: consecutive tiles overlap and cover the document', () => {
        const rand = lcg(42);
        for (let n = 0; n < 500; n++) {
            const vh = 300 + Math.floor(rand() * 1200);
            const docH = vh + Math.floor(rand() * 20000);
            const headerH = rand() < 0.5 ? 0 : Math.floor(rand() * (vh / 4));
            const overlap = overlapFor(1 + rand() * 2);
            const ys = planTileYs(docH, vh, headerH, overlap);
            expect(ys[0]).toBe(0);
            expect(ys[ys.length - 1]).toBe(docH - vh);
            for (let i = 1; i < ys.length; i++) {
                const prevBottom = ys[i - 1] + vh;
                const start = ys[i] + headerH;
                expect(start).toBeLessThanOrEqual(prevBottom - overlap);
                expect(ys[i]).toBeGreaterThan(ys[i - 1]);
            }
        }
    });
    it('nextTileY plans from the actual landing position and clamps', () => {
        expect(nextTileY(0, VH, 56, 2, 5000)).toBe(842);
        expect(nextTileY(4800, VH, 56, 2, 5000)).toBe(5000);
        expect(nextTileY(100, VH, 0, 2, 0)).toBe(0);
    });
});

describe('allocateTileBudget', () => {
    it('window first, then strips, footer reserved', () => {
        expect(allocateTileBudget(10, [5, 3], true, 50)).toEqual({ window: 10, strips: [5, 3], footer: true, truncated: false });
        expect(allocateTileBudget(45, [10, 10], true, 50)).toEqual({ window: 45, strips: [4, 0], footer: true, truncated: true });
        expect(allocateTileBudget(60, [], false, 50)).toEqual({ window: 50, strips: [], footer: false, truncated: true });
    });
});

describe('computeDownscale', () => {
    it('leaves small canvases alone', () => {
        expect(computeDownscale(2880, 10000)).toEqual({ s: 1, width: 2880, height: 10000, downscaled: false });
    });
    it('respects the per-side limit', () => {
        const d = computeDownscale(1000, 40000);
        expect(d.height).toBeLessThanOrEqual(MAX_DIM);
        expect(d.downscaled).toBe(true);
    });
    it('respects the pixel cap', () => {
        const d = computeDownscale(2880, 30000);
        expect(d.width * d.height).toBeLessThanOrEqual(MAX_PIXELS + 2880);
        expect(d.s).toBeCloseTo(Math.sqrt(MAX_PIXELS / (2880 * 30000)), 5);
    });
});

const gmailInput = {
    viewportWidth: VW,
    viewportHeight: VH,
    document: { scrollHeight: VH, scrollable: false },
    strips: [{ index: 0, box: { x: 240, y: 120, width: 1100, height: 760 }, scrollHeight: 4000, clientHeight: 760, insideColor: '#fff' }],
    pageBackground: '#f6f8fc',
    fills: [{ x0: 0, x1: 240, color: '#f6f8fc' }, { x0: 1340, x1: VW, color: '#f6f8fc' }],
};

describe('computeCanvasLayout', () => {
    it('gmail mode: height = boxTop + scrollHeight + tail, side columns filled, tail relocated', () => {
        const layout = computeCanvasLayout(gmailInput);
        expect(layout.gmailMode).toBe(true);
        expect(layout.baseHeightCss).toBe(VH);
        expect(layout.heightCss).toBe(120 + 4000 + (VH - 880));
        expect(layout.owned).toEqual([{ x: 240, y: 120, width: 1100, height: 4000 }]);
        expect(layout.tails).toEqual([{ strip: 0, src: { x: 240, y: 880, width: 1100, height: 20 }, dstY: 4120 }]);
        expect(layout.fills).toEqual([
            { rect: { x: 0, y: VH, width: 240, height: layout.heightCss - VH }, color: '#f6f8fc' },
            { rect: { x: 1340, y: VH, width: 100, height: layout.heightCss - VH }, color: '#f6f8fc' },
        ]);
    });
    it('no tail when the box reaches the viewport bottom', () => {
        const layout = computeCanvasLayout({ ...gmailInput, strips: [{ ...gmailInput.strips[0], box: { x: 240, y: 120, width: 1100, height: VH - 120 } }] });
        expect(layout.tails).toEqual([]);
        expect(layout.heightCss).toBe(120 + 4000);
    });
    it('scrollable document with strips: height is the max, shorter strip column filled with its own colour', () => {
        const layout = computeCanvasLayout({
            viewportWidth: VW,
            viewportHeight: VH,
            document: { scrollHeight: 6000, scrollable: true },
            strips: [
                { index: 0, box: { x: 0, y: 70, width: 270, height: 830 }, scrollHeight: 9000, clientHeight: 830, insideColor: '#fafafa' },
                { index: 1, box: { x: 1100, y: 70, width: 340, height: 830 }, scrollHeight: 2000, clientHeight: 830, insideColor: '#fff' },
            ],
            pageBackground: '#fff',
            fills: [{ x0: 270, x1: 1100, color: '#fff' }],
        });
        expect(layout.gmailMode).toBe(false);
        expect(layout.heightCss).toBe(9070);
        expect(layout.tails).toEqual([]);
        expect(layout.fills).toContainEqual({ rect: { x: 270, y: 6000, width: 830, height: 3070 }, color: '#fff' });
        expect(layout.fills).toContainEqual({ rect: { x: 1100, y: 2070, width: 340, height: 7000 }, color: '#fff' });
        expect(layout.fills.find((f) => f.rect.x === 0)).toBeUndefined();
    });
    it('no strips: nothing owned, nothing filled', () => {
        const layout = computeCanvasLayout({ ...gmailInput, document: { scrollHeight: 5000, scrollable: true }, strips: [] });
        expect(layout).toEqual({ heightCss: 5000, baseHeightCss: 5000, gmailMode: false, owned: [], fills: [], tails: [] });
    });
});

describe('draw ops', () => {
    const scale = 2;
    const bitmapW = VW * scale;
    const bitmapH = VH * scale;

    it('window tile 0 is the whole bitmap at the top', () => {
        const op = windowTileOp({ tileIndex: 0, scrollY: 0, headerH: 56, bitmapW, bitmapH, scale, s: 1, owned: [] });
        expect(op).toEqual({ src: { x: 0, y: 0, width: bitmapW, height: bitmapH }, dst: { x: 0, y: 0, width: bitmapW, height: bitmapH } });
    });
    it('window tiles ≥ 1 clip the header band and land below it', () => {
        const op = windowTileOp({ tileIndex: 1, scrollY: 842, headerH: 56, bitmapW, bitmapH, scale, s: 1, owned: [] });
        expect(op.src).toEqual({ x: 0, y: 112, width: bitmapW, height: bitmapH - 112 });
        expect(op.dst).toEqual({ x: 0, y: (842 + 56) * 2, width: bitmapW, height: bitmapH - 112 });
        expect(op.clipOut).toBeUndefined();
    });
    it('window tiles carry clip-outs intersected with dst', () => {
        const owned = [{ x: 0, y: 70, width: 270, height: 9000 }];
        const op = windowTileOp({ tileIndex: 1, scrollY: 842, headerH: 56, bitmapW, bitmapH, scale, s: 1, owned });
        expect(op.clipOut).toHaveLength(1);
        const c = op.clipOut![0];
        expect(intersectRect(c, op.dst)).toEqual(c);
        expect(c.y).toBe(op.dst.y);
        expect(c.height).toBe(op.dst.height);
        expect(c.width).toBe(540);
    });
    it('owned regions outside the tile produce no clip-out', () => {
        const op = windowTileOp({ tileIndex: 0, scrollY: 0, headerH: 0, bitmapW, bitmapH, scale, s: 1, owned: [{ x: 0, y: 5000, width: 200, height: 100 }] });
        expect(op.clipOut).toBeUndefined();
    });
    it('downscale applies to dst only', () => {
        const op = windowTileOp({ tileIndex: 0, scrollY: 0, headerH: 0, bitmapW, bitmapH, scale, s: 0.5, owned: [] });
        expect(op.src.width).toBe(bitmapW);
        expect(op.dst.width).toBe(bitmapW / 2);
        expect(op.dst.height).toBe(bitmapH / 2);
    });
    it('strip tile lands at box.y + scrollY + scrollTop', () => {
        const op = stripTileOp({ box: { x: 240, y: 120, width: 1100, height: 760 }, scrollY: 0, scrollTop: 1500, scale, s: 1 });
        expect(op.src).toEqual({ x: 480, y: 240, width: 2200, height: 1520 });
        expect(op.dst).toEqual({ x: 480, y: (120 + 1500) * 2, width: 2200, height: 1520 });
    });
    it('viewport rect op copies to a document position', () => {
        const op = viewportRectOp({ rect: { x: 240, y: 880, width: 1100, height: 20 }, dstXCss: 240, dstYCss: 4120, scale, s: 1 });
        expect(op.dst).toEqual({ x: 480, y: 8240, width: 2200, height: 40 });
    });
    it('footer op keeps the distance from the bottom', () => {
        const op = footerOp({ rect: { x: 0, y: VH - 60, width: VW, height: 60 }, vh: VH, canvasHeightPx: 20000, scale, s: 1 });
        expect(op.dst).toEqual({ x: 0, y: 20000 - 120, width: bitmapW, height: 120 });
    });
});
