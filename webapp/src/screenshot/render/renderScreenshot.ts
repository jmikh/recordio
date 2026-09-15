/**
 * Pure screenshot renderer (plans/screenshots Step 8): the cropped source
 * image plus every annotation through the shared overlay painter. Used by
 * the editor canvas, the thumbnail, export (Step 9) and the published
 * render (Step 10) so all four are pixel-identical.
 */
import type { Rect } from '@shared/types';
import type { OverlayItem } from '@shared/types/overlay';
import type { ScreenshotDoc } from '@shared/types/screenshot';
import { drawOverlayItem, type OverlayPaintContext } from '@shared/painters/overlayPainter';
import { effectiveCrop, screenshotScales, thumbnailRect } from '../geometry';

export interface RenderScreenshotOptions {
    /** Region of the source to show; default: the doc's crop (or the full source) */
    view?: Rect;
    /** Text item rendered as HTML by the inline editor — skipped here */
    skipItemId?: string | null;
    /** Drag preview: painted in place of the store item with the same id */
    overrideItem?: OverlayItem | null;
    /** Drag-to-create draft painted on top */
    extraItem?: OverlayItem | null;
}

export const THUMBNAIL_WIDTH = 480;

/** Whether ctx.filter (canvas blur) works here — Safari < 18 lacks it. */
export function supportsCanvasFilter(): boolean {
    if (typeof CanvasRenderingContext2D === 'undefined') return false;
    return 'filter' in CanvasRenderingContext2D.prototype;
}

/**
 * Draws `view` of the source at 1:1 into a canvas sized view.width × view.height.
 * Annotation coordinates are uncropped source px, so the painter runs
 * translated by -view.origin with an identity-scale viewport.
 */
export function renderScreenshot(
    ctx: CanvasRenderingContext2D,
    image: CanvasImageSource,
    doc: ScreenshotDoc,
    options: RenderScreenshotOptions = {},
): void {
    const view = options.view ?? effectiveCrop(doc);
    const { effectScale, textScale } = screenshotScales(view.width);
    const paint: OverlayPaintContext = {
        outputSize: { width: view.width, height: view.height },
        viewport: view,
        effectScale,
        textScale,
    };

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, view.width, view.height);
    ctx.drawImage(image, view.x, view.y, view.width, view.height, 0, 0, view.width, view.height);

    ctx.save();
    ctx.translate(-view.x, -view.y);
    for (const stored of doc.annotations) {
        if (options.skipItemId && stored.id === options.skipItemId && stored.type === 'text') continue;
        const item = options.overrideItem && options.overrideItem.id === stored.id ? options.overrideItem : stored;
        drawOverlayItem(ctx, item, paint);
    }
    if (options.extraItem) drawOverlayItem(ctx, options.extraItem, paint);
    ctx.restore();
}

/** Renders the doc's view into a fresh canvas (export, thumbnail, publish). */
export function renderToCanvas(image: CanvasImageSource, doc: ScreenshotDoc, view?: Rect): HTMLCanvasElement {
    const region = view ?? effectiveCrop(doc);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(region.width));
    canvas.height = Math.max(1, Math.round(region.height));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    renderScreenshot(ctx, image, doc, { view: region });
    return canvas;
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
    return new Promise((resolve, reject) => {
        canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error(`toBlob(${type}) returned null`))), type, quality);
    });
}

/** The rendered view as a PNG blob. */
export async function renderToPngBlob(image: CanvasImageSource, doc: ScreenshotDoc): Promise<Blob> {
    return canvasToBlob(renderToCanvas(image, doc), 'image/png');
}

/** 480 px wide webp of the top 16:9 band of the rendered view (dashboard card). */
export async function renderThumbnail(image: CanvasImageSource, doc: ScreenshotDoc): Promise<Blob> {
    const full = renderToCanvas(image, doc);
    const band = thumbnailRect({ width: full.width, height: full.height });
    const out = document.createElement('canvas');
    out.width = THUMBNAIL_WIDTH;
    out.height = Math.round(THUMBNAIL_WIDTH * band.height / band.width);
    const ctx = out.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    ctx.drawImage(full, band.x, band.y, band.width, band.height, 0, 0, out.width, out.height);
    return canvasToBlob(out, 'image/webp', 0.8);
}
