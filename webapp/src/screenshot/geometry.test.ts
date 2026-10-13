import { describe, it, expect } from 'vitest';
import type { ArrowOverlayItem, BlurOverlayItem, BorderOverlayItem, OverlayItem, TextOverlayItem } from '@shared/types/overlay';
import { DEFAULT_BACKGROUND } from './core/createScreenshotDoc';
import {
    annotationBounds,
    canvasWindow,
    centerItemAt,
    clampRectToBounds,
    defaultSpotlightRect,
    distanceToSegment,
    effectiveCrop,
    fitScale,
    hitTestAnnotations,
    intersectRects,
    normalizeRect,
    pointInEllipse,
    screenshotFrame,
    screenshotScales,
    textItemHeight,
    thumbnailRect,
    translateItem,
} from './geometry';

const blur: BlurOverlayItem = { id: 'b', type: 'blur', rectPx: { x: 10, y: 10, width: 100, height: 50 }, blurRadiusPx: 20, borderRadiusPx: [0, 0, 0, 0] };
const ellipse: BorderOverlayItem = { id: 'e', type: 'border', shape: 'ellipse', rectPx: { x: 0, y: 0, width: 100, height: 100 }, color: '#000', borderWidthPx: 4, borderRadiusPx: [0, 0, 0, 0], effect: 'none' };
const arrow: ArrowOverlayItem = { id: 'a', type: 'arrow', tail: { x: 0, y: 0 }, head: { x: 100, y: 0 }, color: '#000', strokeWidthPx: 4, effect: 'none' };
const text: TextOverlayItem = { id: 't', type: 'text', text: 'one\ntwo', topLeft: { x: 200, y: 200 }, widthPx: 100, fontSizePx: 20, fontFamily: 'Inter', fontWeight: 400, color: '#000', backgroundColor: '#fff' };

describe('normalizeRect / clampRectToBounds', () => {
    it('spans two corners in any orientation', () => {
        expect(normalizeRect({ x: 10, y: 20 }, { x: 5, y: 2 })).toEqual({ x: 5, y: 2, width: 5, height: 18 });
    });
    it('keeps a rect inside bounds and shrinks oversized ones', () => {
        const bounds = { x: 0, y: 0, width: 100, height: 100 };
        expect(clampRectToBounds({ x: 90, y: -5, width: 20, height: 20 }, bounds)).toEqual({ x: 80, y: 0, width: 20, height: 20 });
        expect(clampRectToBounds({ x: 0, y: 0, width: 300, height: 50 }, bounds)).toEqual({ x: 0, y: 0, width: 100, height: 50 });
    });
});

describe('distanceToSegment / pointInEllipse', () => {
    it('measures perpendicular and endpoint distances', () => {
        expect(distanceToSegment({ x: 50, y: 5 }, { x: 0, y: 0 }, { x: 100, y: 0 })).toBe(5);
        expect(distanceToSegment({ x: 110, y: 0 }, { x: 0, y: 0 }, { x: 100, y: 0 })).toBe(10);
        expect(distanceToSegment({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 })).toBe(5);
    });
    it('excludes the corners of the bounding box for ellipses', () => {
        expect(pointInEllipse({ x: 50, y: 50 }, ellipse.rectPx)).toBe(true);
        expect(pointInEllipse({ x: 2, y: 2 }, ellipse.rectPx)).toBe(false);
    });
});

describe('annotationBounds', () => {
    it('pads arrows by half the stroke and text by the painter padding', () => {
        expect(annotationBounds(arrow, 1)).toEqual({ x: -2, y: -2, width: 104, height: 4 });
        // pad = round(8 * 1) = 8; height = 2 lines * 20 * 1.2 + 16
        expect(annotationBounds(text, 1)).toEqual({ x: 192, y: 192, width: 116, height: 64 });
    });

    it('counts word-wrapped lines in the text height, not just newlines', () => {
        // 10px per char: 'aaaa bbbb cccc' in a 100px box wraps to 'aaaa bbbb' + 'cccc'
        const measure = { font: '', measureText: (t: string) => ({ width: t.length * 10 }) } as unknown as CanvasRenderingContext2D;
        const wrapped = { ...text, text: 'aaaa bbbb cccc' };
        expect(textItemHeight(wrapped, 1, measure)).toBe(64);
        expect(textItemHeight({ ...wrapped, text: 'aaaa' }, 1, measure)).toBe(40);
    });
});

describe('hitTestAnnotations', () => {
    const items: OverlayItem[] = [blur, ellipse, arrow, text];
    it('returns the topmost item under the point', () => {
        // blur and ellipse overlap at (50, 30); ellipse is painted later
        expect(hitTestAnnotations(items, { x: 50, y: 30 }, 0, 1)?.id).toBe('e');
        // corner of the ellipse's box is outside the ellipse but inside the blur
        expect(hitTestAnnotations(items, { x: 12, y: 12 }, 0, 1)?.id).toBe('b');
    });
    it('uses the tolerance for thin arrows', () => {
        expect(hitTestAnnotations([arrow], { x: 50, y: 5 }, 6, 1)?.id).toBe('a');
        expect(hitTestAnnotations([arrow], { x: 50, y: 5 }, 1, 1)).toBeNull();
    });
    it('hits text through its padded bounds and misses empty space', () => {
        expect(hitTestAnnotations(items, { x: 195, y: 195 }, 0, 1)?.id).toBe('t');
        expect(hitTestAnnotations(items, { x: 500, y: 500 }, 0, 1)).toBeNull();
    });
});

describe('translateItem / centerItemAt', () => {
    it('moves every item kind', () => {
        expect((translateItem(arrow, 5, 5) as ArrowOverlayItem).head).toEqual({ x: 105, y: 5 });
        expect((translateItem(text, -10, 0) as TextOverlayItem).topLeft).toEqual({ x: 190, y: 200 });
        expect((translateItem(blur, 1, 2) as BlurOverlayItem).rectPx).toEqual({ x: 11, y: 12, width: 100, height: 50 });
    });
    it('centres on the point but stays inside bounds', () => {
        const bounds = { x: 0, y: 0, width: 400, height: 400 };
        const centred = centerItemAt(blur, { x: 200, y: 200 }, bounds, 1) as BlurOverlayItem;
        expect(centred.rectPx).toEqual({ x: 150, y: 175, width: 100, height: 50 });
        const edge = centerItemAt(blur, { x: 395, y: 395 }, bounds, 1) as BlurOverlayItem;
        expect(edge.rectPx).toEqual({ x: 300, y: 350, width: 100, height: 50 });
    });
});

describe('view helpers', () => {
    it('effectiveCrop falls back to the full source', () => {
        const doc = { cropPx: null, source: { widthPx: 800, heightPx: 600 } };
        expect(effectiveCrop(doc)).toEqual({ x: 0, y: 0, width: 800, height: 600 });
        expect(effectiveCrop({ ...doc, cropPx: { x: 1, y: 2, width: 3, height: 4 } })).toEqual({ x: 1, y: 2, width: 3, height: 4 });
    });
    it('fitScale never upscales', () => {
        expect(fitScale({ width: 1000, height: 10 }, 500)).toBe(0.5);
        expect(fitScale({ width: 100, height: 10 }, 500)).toBe(1);
    });
    it('screenshotScales is width-based against 1920', () => {
        expect(screenshotScales(960)).toEqual({ effectScale: 0.5, textScale: 0.5 });
    });
    it('thumbnailRect takes the top 16:9 band of tall images and the centred band of wide ones', () => {
        expect(thumbnailRect({ width: 1600, height: 5000 })).toEqual({ x: 0, y: 0, width: 1600, height: 900 });
        expect(thumbnailRect({ width: 4000, height: 900 })).toEqual({ x: 1200, y: 0, width: 1600, height: 900 });
    });
});

describe('background frame', () => {
    const view = { x: 100, y: 50, width: 1000, height: 400 };

    it('pads every side by a fraction of the view width', () => {
        const frame = screenshotFrame({ ...DEFAULT_BACKGROUND, enabled: true, padding: 0.1 }, view);
        expect(frame.paddingPx).toBe(100);
        expect(frame.size).toEqual({ width: 1200, height: 600 });
        expect(frame.origin).toEqual({ x: 0, y: -50 });
    });
    it('rounds the image corners while the background is on, scaled by width and capped at half a side', () => {
        const on = { ...DEFAULT_BACKGROUND, enabled: true, borderRadiusPx: 48 };
        expect(screenshotFrame(on, { x: 0, y: 0, width: 960, height: 400 }).cornerRadiusPx).toBe(24);
        expect(screenshotFrame({ ...on, padding: 0 }, view).hasBackground).toBe(true);
        expect(screenshotFrame({ ...on, borderRadiusPx: 5000 }, view).cornerRadiusPx).toBe(200);
    });
    it('has no padding when the background is off, missing, or in crop mode', () => {
        const on = { ...DEFAULT_BACKGROUND, enabled: true, padding: 0.1 };
        for (const frame of [
            screenshotFrame({ ...on, enabled: false }, view),
            screenshotFrame(undefined, view),
            screenshotFrame(on, view, true),
        ]) {
            expect(frame.paddingPx).toBe(0);
            expect(frame.hasBackground).toBe(false);
            expect(frame.cornerRadiusPx).toBe(0);
            expect(frame.size).toEqual({ width: 1000, height: 400 });
            expect(frame.origin).toEqual({ x: 100, y: 50 });
        }
    });
});

describe('spotlight geometry', () => {
    it('intersectRects returns the overlap, or null when the rects only touch or miss', () => {
        const a = { x: 0, y: 0, width: 100, height: 100 };
        expect(intersectRects(a, { x: 50, y: 80, width: 100, height: 100 })).toEqual({ x: 50, y: 80, width: 50, height: 20 });
        expect(intersectRects(a, { x: 100, y: 0, width: 10, height: 10 })).toBeNull();
        expect(intersectRects(a, { x: 300, y: 300, width: 10, height: 10 })).toBeNull();
    });
    it('defaultSpotlightRect centres on the click, sized from the width, inside the view', () => {
        const view = { x: 0, y: 0, width: 1000, height: 5000 };
        expect(defaultSpotlightRect({ x: 500, y: 2000 }, view)).toEqual({ x: 300, y: 1875, width: 400, height: 250 });
        // Near a corner it slides back inside
        expect(defaultSpotlightRect({ x: 0, y: 0 }, view)).toEqual({ x: 0, y: 0, width: 400, height: 250 });
        // A short strip caps the height
        expect(defaultSpotlightRect({ x: 500, y: 50 }, { x: 0, y: 0, width: 1000, height: 100 }).height).toBe(100);
    });
});

describe('canvasWindow', () => {
    const box = { width: 1000, height: 20000 };

    it('covers the visible part plus overscan, clamped to the box, mapped to frame px', () => {
        // visible 0..1000 × 5000..5800, overscan 0.5 → y 4600..6200 (x clamps to the box)
        const win = canvasWindow({ x: 0, y: 5000, width: 1000, height: 800 }, box, 0.5, 2, 0.5)!;
        expect(win.display).toEqual({ x: 0, y: 4600, width: 1000, height: 1600 });
        expect(win.pixelSize).toEqual({ width: 2000, height: 3200 });
        expect(win.scale).toBe(1);
        expect(win.frameRect).toEqual({ x: 0, y: 9200, width: 2000, height: 3200 });
    });

    it('snaps to whole device pixels', () => {
        const win = canvasWindow({ x: 0.3, y: 10.3, width: 99.4, height: 49.5 }, box, 1, 1, 0)!;
        expect(win.display).toEqual({ x: 0, y: 10, width: 100, height: 50 });
    });

    it('is null when nothing is visible', () => {
        expect(canvasWindow({ x: 0, y: 0, width: 0, height: 0 }, box, 1, 2, 0.5)).toBeNull();
    });
});
