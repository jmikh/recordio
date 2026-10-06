/**
 * Overlay painter (screenshot annotations) — pins that the item variants
 * (line, ellipse, pixelate) take the intended branches while legacy items
 * (no variant field) keep the old ones.
 *
 * No real canvas in node: a recording stub logs every method call and
 * property assignment in order.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { drawOverlayItem, wrapLines, type OverlayPaintContext } from './overlayPainter';
import type { ArrowOverlayItem, BlurOverlayItem, BorderOverlayItem } from '../types/overlay';

type Call = [string, ...unknown[]];

const METHODS = [
    'save', 'restore', 'scale', 'translate', 'setTransform', 'clip', 'fill', 'stroke',
    'beginPath', 'closePath', 'moveTo', 'lineTo', 'arcTo', 'arc', 'ellipse', 'rect',
    'drawImage', 'fillText', 'clearRect', 'quadraticCurveTo', 'bezierCurveTo',
] as const;

const PROPS = [
    'filter', 'font', 'textBaseline', 'textAlign', 'fillStyle', 'strokeStyle', 'lineWidth',
    'lineCap', 'lineJoin', 'shadowColor', 'shadowBlur', 'shadowOffsetX', 'shadowOffsetY',
    'imageSmoothingEnabled',
] as const;

function stubCtx(calls: Call[]): CanvasRenderingContext2D {
    const target: Record<string, unknown> = {
        canvas: { width: 1920, height: 1080 },
        measureText: (text: string) => ({ width: text.length * 6 }),
        getContext: () => null,
    };
    for (const m of METHODS) {
        target[m] = (...args: unknown[]) => { calls.push([m, ...args]); };
    }
    return new Proxy(target, {
        set(t, prop, value) {
            if (typeof prop === 'string' && (PROPS as readonly string[]).includes(prop)) {
                calls.push([`set:${prop}`, value]);
            }
            t[prop as string] = value;
            return true;
        },
    }) as unknown as CanvasRenderingContext2D;
}

const OUTPUT = { width: 1920, height: 1080 };
const FULL = { x: 0, y: 0, width: 1920, height: 1080 };

function paintCtx(): OverlayPaintContext {
    return { outputSize: OUTPUT, viewport: FULL, effectScale: 1, textScale: 1 };
}

const arrow: ArrowOverlayItem = {
    id: 'a1', type: 'arrow', tail: { x: 100, y: 100 }, head: { x: 300, y: 200 },
    strokeWidthPx: 6, color: '#ff0000', effect: 'shadow',
};
const border: BorderOverlayItem = {
    id: 'b1', type: 'border', rectPx: { x: 50, y: 60, width: 400, height: 300 },
    borderWidthPx: 4, color: '#00ff00', borderRadiusPx: [8, 8, 8, 8], fillColor: '#00ff0033', effect: 'glow',
};
const blur: BlurOverlayItem = {
    id: 'bl1', type: 'blur', rectPx: { x: 10, y: 20, width: 200, height: 100 },
    blurRadiusPx: 12, borderRadiusPx: [4, 4, 4, 4],
};

describe('legacy items keep their branches', () => {
    it('arrow without headStyle fills an arrowhead', () => {
        const calls: Call[] = [];
        drawOverlayItem(stubCtx(calls), arrow, paintCtx());
        expect(calls.filter(c => c[0] === 'fill')).toHaveLength(1);
        expect(calls.filter(c => c[0] === 'stroke')).toHaveLength(1);
    });

    it('border without shape uses the rounded-rect path (no ellipse)', () => {
        const calls: Call[] = [];
        drawOverlayItem(stubCtx(calls), border, paintCtx());
        expect(calls.some(c => c[0] === 'ellipse')).toBe(false);
        expect(calls.some(c => c[0] === 'arcTo' || c[0] === 'rect' || c[0] === 'lineTo')).toBe(true);
    });

    it('blur without mode uses ctx.filter', () => {
        const calls: Call[] = [];
        drawOverlayItem(stubCtx(calls), blur, paintCtx());
        expect(calls).toContainEqual(['set:filter', 'blur(12px)']);
        expect(calls.some(c => c[0] === 'set:imageSmoothingEnabled')).toBe(false);
    });
});

describe('variants', () => {
    it("headStyle 'none' draws the shaft to the tip and never fills a head", () => {
        const calls: Call[] = [];
        drawOverlayItem(stubCtx(calls), { ...arrow, headStyle: 'none' }, paintCtx());
        expect(calls.some(c => c[0] === 'fill')).toBe(false);
        expect(calls).toContainEqual(['lineTo', arrow.head.x, arrow.head.y]);
    });

    it("shape 'ellipse' strokes (and fills) an ellipse inset by half the border width", () => {
        const calls: Call[] = [];
        drawOverlayItem(stubCtx(calls), { ...border, shape: 'ellipse' }, paintCtx());
        const ellipses = calls.filter(c => c[0] === 'ellipse');
        expect(ellipses).toHaveLength(2); // fill + stroke
        const stroked = ellipses[1];
        // rect 50,60 400×300, border 4 → inset 52,62 396×296 → centre 250,210, radii 198,148
        expect(stroked.slice(1, 5)).toEqual([250, 210, 198, 148]);
        expect(calls.some(c => c[0] === 'arcTo')).toBe(false);
    });

    describe("mode 'pixelate'", () => {
        beforeEach(() => {
            // node has no OffscreenCanvas — provide one whose 2d context records nothing
            (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = class {
                width: number; height: number;
                constructor(w: number, h: number) { this.width = w; this.height = h; }
                getContext() {
                    return { imageSmoothingEnabled: true, clearRect() {}, drawImage() {} };
                }
            };
        });

        it('downsamples to a scratch canvas and draws back with smoothing off, no ctx.filter', () => {
            const calls: Call[] = [];
            drawOverlayItem(stubCtx(calls), { ...blur, mode: 'pixelate' }, paintCtx());
            expect(calls).toContainEqual(['set:imageSmoothingEnabled', false]);
            expect(calls.some(c => c[0] === 'set:filter')).toBe(false);
            const draw = calls.find(c => c[0] === 'drawImage')!;
            // scratch is 200/12 → 17 × 100/12 → 9 cells, drawn back at the rect
            expect(draw.slice(2, 6)).toEqual([0, 0, 17, 9]);
            expect(draw.slice(6)).toEqual([10, 20, 200, 100]);
        });
    });
});

describe('wrapLines', () => {
    it('wraps on spaces and breaks over-long words by character', () => {
        const ctx = stubCtx([]);
        // 6px per char → 30px fits 5 chars
        expect(wrapLines(ctx, 'ab cd ef', 30)).toEqual(['ab cd', 'ef']);
        expect(wrapLines(ctx, 'abcdefgh', 30)).toEqual(['abcde', 'fgh']);
        expect(wrapLines(ctx, '', 30)).toEqual(['']);
    });
});
