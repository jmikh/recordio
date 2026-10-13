/**
 * Pure screenshot renderer (plans/screenshots Step 8): the background
 * frame, the cropped source image, the spotlight and every annotation
 * through the shared painters. Used by the editor canvas, the thumbnail,
 * export (Step 9) and the published render (Step 10) so all four are
 * pixel-identical.
 */
import type { BackgroundSettings, Rect, Size } from '@shared/types';
import type { OverlayItem } from '@shared/types/overlay';
import type { ScreenshotBackground, ScreenshotDoc, ScreenshotSpotlight } from '@shared/types/screenshot';
import type { SpotlightState } from '@shared/animators/spotlightAnimator';
import { drawOverlayItem, type OverlayPaintContext } from '@shared/painters/overlayPainter';
import { drawBackground } from '@shared/painters/backgroundPainter';
import { drawSpotlight } from '@shared/painters/spotlightPainter';
import { roundRectPath } from '@shared/painters/utils/roundRect';
import { browserRenderContext } from '../../editor/utils/renderContext';
import { effectiveCrop, intersectRects, screenshotFrame, screenshotScales, thumbnailRect, type ScreenshotFrame } from '../geometry';

export interface RenderScreenshotOptions {
    /** Region of the source to show; default: the doc's crop (or the full source) */
    view?: Rect;
    /** Crop mode: the source and annotations only — no background padding, no spotlight */
    bare?: boolean;
    /** Text item rendered as HTML by the inline editor — skipped here */
    skipItemId?: string | null;
    /** Drag preview: painted in place of the store item with the same id */
    overrideItem?: OverlayItem | null;
    /** Drag-to-create draft painted on top */
    extraItem?: OverlayItem | null;
    /** Painted instead of the doc's spotlight (draft / drag preview); undefined = the doc's */
    spotlight?: ScreenshotSpotlight | null;
    /**
     * Paint only `rect` of the frame (frame px) at `scale` canvas px per frame
     * px — the editor's on-screen window. Default: the whole frame at 1:1.
     */
    visible?: { rect: Rect; scale: number };
    /** TEMP [ScreenshotPerf]: when passed, filled with ms spent per paint phase */
    perf?: Record<string, number>;
}
export const THUMBNAIL_WIDTH = 960;

/** Whether ctx.filter (canvas blur) works here — Safari < 18 lacks it. */
export function supportsCanvasFilter(): boolean {
    if (typeof CanvasRenderingContext2D === 'undefined') return false;
    return 'filter' in CanvasRenderingContext2D.prototype;
}

/**
 * Draws `view` of the source at 1:1 into a canvas sized to its frame
 * (view + background padding on every side, see screenshotFrame). Paint
 * order: background, image (corners rounded while the background is on),
 * spotlight dim, annotations — annotations stay bright over the dim, like
 * the video editor's overlays.
 *
 * Annotation coordinates are uncropped source px, so the painter runs
 * translated by -frame.origin, with the painted part of the frame as its
 * viewport so blur/pixelate project onto the padded canvas.
 *
 * With `options.visible` only that part of the frame is painted, scaled into
 * the canvas — the editor draws just what's on screen instead of the full
 * source resolution (a long capture exceeds the GPU's texture limit and
 * drops the canvas to CPU raster).
 */
export function renderScreenshot(
    ctx: CanvasRenderingContext2D,
    image: CanvasImageSource,
    doc: ScreenshotDoc,
    options: RenderScreenshotOptions = {},
): void {
    const view = options.view ?? effectiveCrop(doc);
    const frame = screenshotFrame(doc.background, view, options.bare);
    const { effectScale, textScale } = screenshotScales(view.width);
    const win = options.visible?.rect ?? { x: 0, y: 0, ...frame.size };
    const s = options.visible?.scale ?? 1;
    const canvasSize = { width: win.width * s, height: win.height * s };
    const paint: OverlayPaintContext = {
        outputSize: canvasSize,
        viewport: { x: frame.origin.x + win.x, y: frame.origin.y + win.y, width: win.width, height: win.height },
        // Shadow blur/offset are device px — the transform doesn't scale them
        effectScale: effectScale * s,
        textScale,
    };

    const rounded = frame.cornerRadiusPx > 0;
    /** Clips to the rounded image, its top-left at (x, y) in the current transform. */
    const clipToImage = (x: number, y: number) => {
        roundRectPath(ctx, x, y, view.width, view.height, frame.cornerRadiusPx);
        ctx.clip();
    };

    // TEMP [ScreenshotPerf]: accumulates ms since the previous lap under `phase`
    const perf = options.perf;
    let lapStart = perf ? performance.now() : 0;
    const lap = (phase: string) => {
        if (!perf) return;
        const now = performance.now();
        perf[phase] = (perf[phase] ?? 0) + now - lapStart;
        lapStart = now;
    };

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvasSize.width, canvasSize.height);
    lap('clear');
    // Frame px → canvas px from here on
    ctx.setTransform(s, 0, 0, s, -win.x * s, -win.y * s);
    if (frame.hasBackground) drawBackground(ctx, toBackgroundSettings(doc.background), 0, frame.size, null);
    lap('background');
    // Only the slice of the image inside the painted window
    const dst = intersectRects({ x: frame.paddingPx, y: frame.paddingPx, width: view.width, height: view.height }, win);
    if (dst) {
        ctx.save();
        if (rounded) clipToImage(frame.paddingPx, frame.paddingPx);
        // Downscaling: average every source pixel, or text shimmers/aliases
        if (s < 1) ctx.imageSmoothingQuality = 'high';
        const sx = view.x + dst.x - frame.paddingPx;
        const sy = view.y + dst.y - frame.paddingPx;
        ctx.drawImage(image, sx, sy, dst.width, dst.height, dst.x, dst.y, dst.width, dst.height);
        ctx.restore();
    }
    lap('image');

    if (!options.bare) {
        const spotlight = options.spotlight !== undefined ? options.spotlight : doc.spotlight;
        if (spotlight) paintSpotlight(ctx, spotlight, frame, win, s, paint.effectScale, canvasSize);
    }
    lap('spotlight');

    ctx.save();
    ctx.translate(-frame.origin.x, -frame.origin.y);
    for (const stored of doc.annotations) {
        if (options.skipItemId && stored.id === options.skipItemId && stored.type === 'text') continue;
        const item = options.overrideItem && options.overrideItem.id === stored.id ? options.overrideItem : stored;
        // Blur samples the canvas, so in a rounded corner it would smear the background in
        const clip = rounded && item.type === 'blur';
        if (clip) {
            ctx.save();
            clipToImage(view.x, view.y);
        }
        drawOverlayItem(ctx, item, paint);
        if (clip) ctx.restore();
        lap(item.type === 'blur' ? `blur:${item.mode ?? 'blur'}` : item.type);
    }
    if (options.extraItem) drawOverlayItem(ctx, options.extraItem, paint);
    lap('draft');
    ctx.restore();
}

/** The video painter's settings shape for a colour/gradient backdrop. */
function toBackgroundSettings(bg: ScreenshotBackground): BackgroundSettings {
    return {
        type: 'color',
        colorMode: bg.colorMode,
        color: bg.color,
        gradientColors: bg.gradientColors,
        gradientDirection: bg.gradientDirection,
        backgroundBlurPx: 0,
    };
}

/**
 * The video spotlight painter at full strength. The lit area is clipped to
 * the view so the padding never shows through; a spotlight cropped out
 * entirely paints nothing (dimming the whole image would highlight nothing).
 *
 * The painter works in raw canvas px (it snapshots the canvas and draws it
 * back), so the rect is mapped through the painted window `win` at scale `s`
 * and the transform is reset for the call. `effectScale` already includes `s`.
 */
function paintSpotlight(
    ctx: CanvasRenderingContext2D,
    spotlight: ScreenshotSpotlight,
    frame: ScreenshotFrame,
    win: Rect,
    s: number,
    effectScale: number,
    canvasSize: Size,
): void {
    const visible = intersectRects(spotlight.rectPx, frame.view);
    if (!visible) return;
    const state: SpotlightState = {
        isVisible: true,
        originalRect: {
            x: (visible.x - frame.origin.x - win.x) * s,
            y: (visible.y - frame.origin.y - win.y) * s,
            width: visible.width * s,
            height: visible.height * s,
        },
        sourceRect: spotlight.rectPx,
        borderRadiusPx: spotlight.borderRadiusPx.map(r => r * s) as [number, number, number, number],
        dimOpacity: spotlight.dimOpacity,
        fullDimOpacity: spotlight.dimOpacity,
        featherPx: spotlight.featherPx * effectScale,
        progress: 1,
        phase: 'hold',
        featherTransition: 'fade',
    };
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    drawSpotlight(ctx, state, canvasSize, ctx.canvas, browserRenderContext);
    ctx.restore();
}

/** Renders the doc's view (and its background frame) into a fresh canvas (export, thumbnail, publish). */
export function renderToCanvas(image: CanvasImageSource, doc: ScreenshotDoc, view?: Rect): HTMLCanvasElement {
    const region = view ?? effectiveCrop(doc);
    const { size } = screenshotFrame(doc.background, region);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(size.width));
    canvas.height = Math.max(1, Math.round(size.height));
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

/**
 * 960 px wide webp (2× a dashboard card) of the top 16:9 band of the
 * rendered view. 'high' smoothing averages every source pixel instead of
 * bilinear's 4-pixel sample, which leaves text speckled at large reductions.
 */
export async function renderThumbnail(image: CanvasImageSource, doc: ScreenshotDoc): Promise<Blob> {
    const full = renderToCanvas(image, doc);
    const band = thumbnailRect({ width: full.width, height: full.height });
    const out = document.createElement('canvas');
    out.width = THUMBNAIL_WIDTH;
    out.height = Math.round(THUMBNAIL_WIDTH * band.height / band.width);
    const ctx = out.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(full, band.x, band.y, band.width, band.height, 0, 0, out.width, out.height);
    return canvasToBlob(out, 'image/webp', 0.9);
}
