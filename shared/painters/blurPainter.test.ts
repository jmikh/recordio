/**
 * Blur painter — the active-segment lookup and per-region painting of the
 * video blur track. No real canvas in node: a recording stub logs the calls.
 */
import { describe, expect, it } from 'vitest';
import { drawBlurs, drawBlurSegment, getActiveBlurSegment } from './blurPainter';
import type { BlurSegment } from '../types/blur';

type Call = [string, ...unknown[]];

function stubCtx(calls: Call[]): CanvasRenderingContext2D {
    const target: Record<string, unknown> = { canvas: { width: 1920, height: 1080 } };
    for (const m of ['save', 'restore', 'setTransform', 'clip', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'arcTo', 'rect', 'drawImage']) {
        target[m] = (...args: unknown[]) => { calls.push([m, ...args]); };
    }
    return new Proxy(target, {
        set(t, prop, value) {
            if (prop === 'filter') calls.push(['set:filter', value]);
            t[prop as string] = value;
            return true;
        },
    }) as unknown as CanvasRenderingContext2D;
}

const OUTPUT = { width: 1920, height: 1080 };
const FULL = { x: 0, y: 0, width: 1920, height: 1080 };

function segment(id: string, startMs: number, endMs: number, overrides: Partial<BlurSegment> = {}): BlurSegment {
    return {
        id,
        sourceStartTimeMs: startMs,
        sourceEndTimeMs: endMs,
        outputStartTimeMs: startMs,
        outputEndTimeMs: endMs,
        visible: true,
        blurRadiusPx: 12,
        regions: [
            { id: `${id}-r1`, rectPx: { x: 10, y: 20, width: 200, height: 100 }, borderRadiusPx: [0, 0, 0, 0] },
            { id: `${id}-r2`, rectPx: { x: 600, y: 400, width: 100, height: 50 }, borderRadiusPx: [4, 4, 4, 4] },
        ],
        ...overrides,
    };
}

describe('getActiveBlurSegment', () => {
    const segments = [segment('a', 0, 1000), segment('b', 2000, 3000), segment('hidden', 4000, 5000, { visible: false })];

    it('finds the segment covering the time, inclusive of both ends', () => {
        expect(getActiveBlurSegment(segments, 0)?.id).toBe('a');
        expect(getActiveBlurSegment(segments, 2500)?.id).toBe('b');
        expect(getActiveBlurSegment(segments, 3000)?.id).toBe('b');
    });

    it('returns nothing in gaps or for segments hidden by a cut', () => {
        expect(getActiveBlurSegment(segments, 1500)).toBeUndefined();
        expect(getActiveBlurSegment(segments, 4500)).toBeUndefined();
    });
});

describe('drawBlurs', () => {
    it('blurs every region of the active segment with the segment radius', () => {
        const calls: Call[] = [];
        drawBlurs(stubCtx(calls), [segment('a', 0, 1000)], 500, OUTPUT, FULL);
        const draws = calls.filter(c => c[0] === 'drawImage');
        expect(draws).toHaveLength(2);
        expect(calls.filter(c => c[0] === 'set:filter' && c[1] === 'blur(12px)')).toHaveLength(2);
    });

    it('draws nothing when no segment is active', () => {
        const calls: Call[] = [];
        drawBlurs(stubCtx(calls), [segment('a', 0, 1000)], 1500, OUTPUT, FULL);
        expect(calls).toEqual([]);
    });

    it('zoomed viewport: regions project through the viewport in canvas space', () => {
        const calls: Call[] = [];
        const viewport = { x: 480, y: 270, width: 960, height: 540 }; // 2× zoom
        drawBlurs(stubCtx(calls), [segment('a', 0, 1000, { regions: [segment('a', 0, 1000).regions[0]] })], 500, OUTPUT, viewport);
        const draw = calls.find(c => c[0] === 'drawImage')!;
        // rect (10,20) − viewport (480,270) → negative, ×2 — clamped src at 0 on both axes
        expect(draw[2]).toBe(0);
        expect(draw[3]).toBe(0);
        expect(calls).toContainEqual(['set:filter', 'blur(24px)']); // 12 × 2
    });
});

describe('drawBlurSegment', () => {
    it('paints substitute regions instead of the stored ones (editor drag preview)', () => {
        const calls: Call[] = [];
        const seg = segment('a', 0, 1000);
        const moved = [{ ...seg.regions[0], rectPx: { x: 300, y: 300, width: 200, height: 100 } }];
        drawBlurSegment(stubCtx(calls), seg, OUTPUT, FULL, moved);
        const draws = calls.filter(c => c[0] === 'drawImage');
        expect(draws).toHaveLength(1);
        // src x = 300 − 2 × 12 expand
        expect(draws[0][2]).toBe(276);
    });
});
