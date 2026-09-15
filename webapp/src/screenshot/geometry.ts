/**
 * Pure geometry for the screenshot editor (plans/screenshots Step 8).
 * Every coordinate is in uncropped source pixels unless stated otherwise.
 */
import type { Rect, Size } from '@shared/types';
import type { OverlayItem, TextOverlayItem } from '@shared/types/overlay';
import type { ScreenshotDoc } from '@shared/types/screenshot';
import { TEXT_REF_PADDING } from '@shared/painters/overlayPainter';

export interface Point { x: number; y: number }

/** Reference width the painter's effect/text scales are 1.0 at. */
export const SCALE_REF_WIDTH = 1920;

/** Hit tolerance around thin items (arrows, lines) in DISPLAY px. */
export const HIT_TOLERANCE_DISPLAY_PX = 6;

/** Painter scales for a view of the given width (width-based so tall pages don't inflate). */
export function screenshotScales(viewWidth: number): { effectScale: number; textScale: number } {
    const s = viewWidth / SCALE_REF_WIDTH;
    return { effectScale: s, textScale: s };
}

/** The crop, or the full source when there is none. */
export function effectiveCrop(doc: { cropPx: Rect | null; source: Pick<ScreenshotDoc['source'], 'widthPx' | 'heightPx'> }): Rect {
    return doc.cropPx ?? { x: 0, y: 0, width: doc.source.widthPx, height: doc.source.heightPx };
}

export function fullSourceRect(size: Size): Rect {
    return { x: 0, y: 0, width: size.width, height: size.height };
}

/** Rectangle spanned by two corners (any orientation). */
export function normalizeRect(a: Point, b: Point): Rect {
    return {
        x: Math.min(a.x, b.x),
        y: Math.min(a.y, b.y),
        width: Math.abs(a.x - b.x),
        height: Math.abs(a.y - b.y),
    };
}

/** Clamps a rect inside bounds, shrinking it when it doesn't fit. */
export function clampRectToBounds(rect: Rect, bounds: Rect): Rect {
    const width = Math.min(rect.width, bounds.width);
    const height = Math.min(rect.height, bounds.height);
    const x = Math.min(Math.max(rect.x, bounds.x), bounds.x + bounds.width - width);
    const y = Math.min(Math.max(rect.y, bounds.y), bounds.y + bounds.height - height);
    return { x, y, width, height };
}

export function clampPoint(p: Point, bounds: Rect): Point {
    return {
        x: Math.min(Math.max(p.x, bounds.x), bounds.x + bounds.width),
        y: Math.min(Math.max(p.y, bounds.y), bounds.y + bounds.height),
    };
}

export function rectContains(rect: Rect, p: Point): boolean {
    return p.x >= rect.x && p.x <= rect.x + rect.width && p.y >= rect.y && p.y <= rect.y + rect.height;
}

export function pointInEllipse(p: Point, rect: Rect): boolean {
    const rx = rect.width / 2;
    const ry = rect.height / 2;
    if (rx <= 0 || ry <= 0) return false;
    const dx = (p.x - (rect.x + rx)) / rx;
    const dy = (p.y - (rect.y + ry)) / ry;
    return dx * dx + dy * dy <= 1;
}

/** Distance from p to the segment ab. */
export function distanceToSegment(p: Point, a: Point, b: Point): number {
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const lenSq = abx * abx + aby * aby;
    let t = lenSq === 0 ? 0 : ((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const cx = a.x + t * abx;
    const cy = a.y + t * aby;
    return Math.hypot(p.x - cx, p.y - cy);
}

/** Approximate rendered height of a text item (newlines only; the painter also word-wraps). */
export function textItemHeight(item: TextOverlayItem, textScale: number): number {
    const lines = Math.max(1, item.text.split('\n').length);
    const pad = Math.round(TEXT_REF_PADDING * textScale);
    return lines * item.fontSizePx * 1.2 + pad * 2;
}

/** Bounding rect of an annotation (arrows padded by half their stroke). */
export function annotationBounds(item: OverlayItem, textScale: number): Rect {
    switch (item.type) {
        case 'blur':
        case 'border':
            return { ...item.rectPx };
        case 'arrow': {
            const pad = item.strokeWidthPx / 2;
            const r = normalizeRect(item.tail, item.head);
            return { x: r.x - pad, y: r.y - pad, width: r.width + pad * 2, height: r.height + pad * 2 };
        }
        case 'text': {
            const pad = Math.round(TEXT_REF_PADDING * textScale);
            return {
                x: item.topLeft.x - pad,
                y: item.topLeft.y - pad,
                width: item.widthPx + pad * 2,
                height: textItemHeight(item, textScale),
            };
        }
    }
}

/** Whether p hits the item; `tolerance` (source px) widens thin shapes. */
export function hitTestAnnotation(item: OverlayItem, p: Point, tolerance: number, textScale: number): boolean {
    switch (item.type) {
        case 'arrow':
            return distanceToSegment(p, item.tail, item.head) <= Math.max(item.strokeWidthPx / 2, tolerance);
        case 'border':
            return item.shape === 'ellipse' ? pointInEllipse(p, item.rectPx) : rectContains(item.rectPx, p);
        case 'blur':
            return rectContains(item.rectPx, p);
        case 'text':
            return rectContains(annotationBounds(item, textScale), p);
    }
}

/** Topmost (last painted) annotation under p, or null. */
export function hitTestAnnotations(items: OverlayItem[], p: Point, tolerance: number, textScale: number): OverlayItem | null {
    for (let i = items.length - 1; i >= 0; i--) {
        if (hitTestAnnotation(items[i], p, tolerance, textScale)) return items[i];
    }
    return null;
}

/** The same item shifted by (dx, dy). */
export function translateItem(item: OverlayItem, dx: number, dy: number): OverlayItem {
    switch (item.type) {
        case 'blur':
        case 'border':
            return { ...item, rectPx: { ...item.rectPx, x: item.rectPx.x + dx, y: item.rectPx.y + dy } };
        case 'arrow':
            return {
                ...item,
                tail: { x: item.tail.x + dx, y: item.tail.y + dy },
                head: { x: item.head.x + dx, y: item.head.y + dy },
            };
        case 'text':
            return { ...item, topLeft: { x: item.topLeft.x + dx, y: item.topLeft.y + dy } };
    }
}

/** Moves an item so its bounds are centred on p, keeping it inside bounds. */
export function centerItemAt(item: OverlayItem, p: Point, bounds: Rect, textScale: number): OverlayItem {
    const b = annotationBounds(item, textScale);
    const target = clampRectToBounds({ ...b, x: p.x - b.width / 2, y: p.y - b.height / 2 }, bounds);
    return translateItem(item, Math.round(target.x - b.x), Math.round(target.y - b.y));
}

/** Display scale that fits `size` into `maxWidth` without upscaling. */
export function fitScale(size: Size, maxWidth: number): number {
    if (size.width <= 0 || maxWidth <= 0) return 1;
    return Math.min(1, maxWidth / size.width);
}

/** The 16:9 region a thumbnail shows: full width from the top, or the full height centred when wider. */
export function thumbnailRect(size: Size): Rect {
    const targetHeight = size.width * 9 / 16;
    if (targetHeight <= size.height) {
        return { x: 0, y: 0, width: size.width, height: Math.round(targetHeight) };
    }
    const width = Math.round(size.height * 16 / 9);
    return { x: Math.round((size.width - width) / 2), y: 0, width, height: size.height };
}
