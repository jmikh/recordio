import { describe, it, expect } from 'vitest';
import type { ArrowOverlayItem, BlurOverlayItem, BorderOverlayItem, OverlayItem, TextOverlayItem } from '@shared/types/overlay';
import {
    annotationBounds,
    centerItemAt,
    clampRectToBounds,
    distanceToSegment,
    effectiveCrop,
    fitScale,
    hitTestAnnotations,
    normalizeRect,
    pointInEllipse,
    screenshotScales,
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
