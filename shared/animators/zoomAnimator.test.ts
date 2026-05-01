import { describe, it, expect } from 'vitest';
import { getViewportStateAtTime, interpolateRect } from './zoomAnimator';
import type { ZoomSegment, Rect, ZoomSettings } from '../types';

// ==========================================
// Helpers
// ==========================================

const outputSize = { width: 1920, height: 1080 };
const fullRect: Rect = { x: 0, y: 0, width: 1920, height: 1080 };

const defaultSettings: ZoomSettings = {
    enabled: true,
    maxZoom: 4,
    transitionDurationMs: 300,
    easing: 'linear',
};

function zoom(
    outputStart: number,
    outputEnd: number,
    rect: Rect,
    overrides?: Partial<ZoomSegment>
): ZoomSegment {
    return {
        id: `z-${outputStart}`,
        sourceStartTimeMs: outputStart,
        sourceEndTimeMs: outputEnd,
        outputStartTimeMs: outputStart,
        outputEndTimeMs: outputEnd,
        visible: true,
        rectPx: rect,
        reason: 'test',
        type: 'manual',
        transitionDurationMs: 300,
        easing: 'linear',
        ...overrides,
    };
}

const zoomedRect: Rect = { x: 500, y: 300, width: 960, height: 540 };

// ==========================================
// interpolateRect
// ==========================================

describe('interpolateRect', () => {
    const from: Rect = { x: 0, y: 0, width: 100, height: 100 };
    const to: Rect = { x: 50, y: 50, width: 200, height: 200 };

    it('t=0 returns from', () => expect(interpolateRect(from, to, 0)).toEqual(from));
    it('t=1 returns to', () => expect(interpolateRect(from, to, 1)).toEqual(to));
    it('t=0.5 returns midpoint', () => {
        expect(interpolateRect(from, to, 0.5)).toEqual({ x: 25, y: 25, width: 150, height: 150 });
    });
});

// ==========================================
// getViewportStateAtTime
// ==========================================

describe('getViewportStateAtTime', () => {
    describe('no segments', () => {
        it('returns full rect', () => {
            expect(getViewportStateAtTime([], 500, outputSize, defaultSettings)).toEqual(fullRect);
        });
    });

    describe('all segments invisible', () => {
        it('returns full rect', () => {
            const segs = [zoom(0, 1000, zoomedRect, { visible: false })];
            expect(getViewportStateAtTime(segs, 500, outputSize, defaultSettings)).toEqual(fullRect);
        });
    });

    describe('before first segment', () => {
        it('returns full rect', () => {
            const segs = [zoom(1000, 2000, zoomedRect)];
            expect(getViewportStateAtTime(segs, 500, outputSize, defaultSettings)).toEqual(fullRect);
        });
    });

    describe('single segment lifecycle', () => {
        // Segment: 1000-2000, transition=300, easing=linear
        const segs = [zoom(1000, 2000, zoomedRect)];

        it('at segment start: begins transition from full rect', () => {
            const result = getViewportStateAtTime(segs, 1000, outputSize, defaultSettings);
            // t=0 of transition → should be at fullRect
            expect(result).toEqual(fullRect);
        });

        it('during transition in (t=0.5): halfway between full and zoomed', () => {
            // 150ms into 300ms transition → t=0.5
            const result = getViewportStateAtTime(segs, 1150, outputSize, defaultSettings);
            expect(result).toEqual(interpolateRect(fullRect, zoomedRect, 0.5));
        });

        it('after transition in: holds at zoomed rect', () => {
            const result = getViewportStateAtTime(segs, 1500, outputSize, defaultSettings);
            expect(result).toEqual(zoomedRect);
        });

        it('after segment end: zooms back to full rect', () => {
            // 150ms after segment end → halfway through zoom-out
            const result = getViewportStateAtTime(segs, 2150, outputSize, defaultSettings);
            expect(result).toEqual(interpolateRect(zoomedRect, fullRect, 0.5));
        });

        it('well after segment end: back to full rect', () => {
            const result = getViewportStateAtTime(segs, 2500, outputSize, defaultSettings);
            expect(result).toEqual(fullRect);
        });
    });

    describe('two segments with gap', () => {
        const rect1: Rect = { x: 100, y: 100, width: 800, height: 500 };
        const rect2: Rect = { x: 500, y: 300, width: 600, height: 400 };
        // T=300, gap of 1000ms (more than T)
        const segs = [zoom(0, 1000, rect1), zoom(2000, 3000, rect2)];

        it('during first segment hold', () => {
            expect(getViewportStateAtTime(segs, 500, outputSize, defaultSettings)).toEqual(rect1);
        });

        it('gap completes zoom-out (gap > T): next segment starts from full rect', () => {
            // At the start of segment 2 (t=2000), gap was 1000ms > T=300, so fully zoomed out
            const result = getViewportStateAtTime(segs, 2000, outputSize, defaultSettings);
            expect(result).toEqual(fullRect); // transitions in from full rect
        });
    });

    describe('two segments with short gap (gap < T)', () => {
        const rect1: Rect = { x: 100, y: 100, width: 800, height: 500 };
        const rect2: Rect = { x: 500, y: 300, width: 600, height: 400 };
        // T=300, gap of 100ms (less than T → partial zoom-out)
        const segs = [zoom(0, 1000, rect1), zoom(1100, 2000, rect2)];

        it('short gap: next segment starts from partially-zoomed-out state', () => {
            // Gap is 100ms, T=300 → t = 100/300 ≈ 0.333
            // At seg2 start, currentRect = interpolateRect(rect1, fullRect, 100/300)
            const partialZoomOut = interpolateRect(rect1, fullRect, 100 / 300);
            // seg2 transition starts from this point
            const result = getViewportStateAtTime(segs, 1100, outputSize, defaultSettings);
            // At t=0 of seg2 transition, it should be at partialZoomOut
            expect(result.x).toBeCloseTo(partialZoomOut.x, 5);
            expect(result.y).toBeCloseTo(partialZoomOut.y, 5);
        });
    });
});

