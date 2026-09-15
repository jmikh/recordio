/**
 * @fileoverview Executes full-page draw ops on an OffscreenCanvas (service worker).
 *
 * Owns the downscale `s` (canvas limits), grows by copying when the plan's
 * height changes (assigning canvas.height would clear it), applies even-odd
 * clip-outs so window tiles never paint into strip-owned regions, and crops
 * to what was actually drawn before the PNG is encoded.
 */

import type { Rect } from '@shared/types';
import { computeDownscale, type DrawOp } from '../shared/fullPagePlan';

export class FullPageStitcher {
    /** Device px per css px in the captured bitmaps */
    readonly scale: number;
    private canvas: OffscreenCanvas | null = null;
    private ctx: OffscreenCanvasRenderingContext2D | null = null;
    private _s = 1;
    private drawnBottom = 0;
    private downscaled = false;
    private rescaled = false;

    constructor(readonly bitmapWidth: number, viewportWidthCss: number, private readonly background: string) {
        this.scale = viewportWidthCss > 0 ? bitmapWidth / viewportWidthCss : 1;
    }

    get s(): number { return this._s; }
    get width(): number { return this.canvas?.width ?? 0; }
    get height(): number { return this.canvas?.height ?? 0; }
    get wasDownscaled(): boolean { return this.downscaled; }
    /** The downscale had to drop after content was drawn (quality hit; rare) */
    get wasRescaled(): boolean { return this.rescaled; }

    /** Creates or grows the canvas to hold `heightCss` rows. Existing content is copied (rescaled if `s` dropped). */
    ensureHeight(heightCss: number): void {
        const fullH = Math.max(1, Math.round(heightCss * this.scale));
        const d = computeDownscale(this.bitmapWidth, fullH);

        if (!this.canvas || !this.ctx) {
            this.canvas = new OffscreenCanvas(d.width, d.height);
            this.ctx = this.context(this.canvas);
            this._s = d.s;
            this.downscaled = d.downscaled;
            this.ctx.fillStyle = this.background;
            this.ctx.fillRect(0, 0, d.width, d.height);
            return;
        }
        if (d.height <= this.canvas.height && d.s === this._s) return;

        const next = new OffscreenCanvas(d.width, Math.max(d.height, Math.round(this.canvas.height * (d.s / this._s))));
        const nctx = this.context(next);
        nctx.fillStyle = this.background;
        nctx.fillRect(0, 0, next.width, next.height);
        const f = d.s / this._s;
        nctx.drawImage(this.canvas, 0, 0, Math.round(this.canvas.width * f), Math.round(this.canvas.height * f));
        if (f < 1) {
            this.rescaled = true;
            this.drawnBottom = Math.round(this.drawnBottom * f);
        }
        // Free the old backing store
        this.canvas.width = 0;
        this.canvas.height = 0;
        this.canvas = next;
        this.ctx = nctx;
        this._s = d.s;
        this.downscaled = this.downscaled || d.downscaled;
    }

    /** Fills a css-document rect (used for the columns no tile paints). */
    fillCss(rect: Rect, color: string): void {
        const ctx = this.require();
        const k = this.scale * this._s;
        ctx.fillStyle = color;
        ctx.fillRect(Math.round(rect.x * k), Math.round(rect.y * k), Math.round(rect.width * k), Math.round(rect.height * k));
    }

    draw(op: DrawOp, bitmap: ImageBitmap): void {
        const ctx = this.require();
        const src = clampToBitmap(op.src, bitmap);
        if (!src || op.dst.width <= 0 || op.dst.height <= 0) return;
        ctx.save();
        if (op.clipOut?.length) {
            const path = new Path2D();
            path.rect(op.dst.x, op.dst.y, op.dst.width, op.dst.height);
            for (const r of op.clipOut) path.rect(r.x, r.y, r.width, r.height);
            ctx.clip(path, 'evenodd');
        }
        ctx.drawImage(bitmap, src.x, src.y, src.width, src.height, op.dst.x, op.dst.y, op.dst.width, op.dst.height);
        ctx.restore();
        this.drawnBottom = Math.max(this.drawnBottom, op.dst.y + op.dst.height);
    }

    /** Drops rows below the last drawn pixel (a document that shrank mid-capture). */
    cropToDrawn(): void {
        if (!this.canvas || !this.ctx) return;
        const target = Math.max(1, Math.min(this.canvas.height, this.drawnBottom));
        if (target >= this.canvas.height - 2) return;
        const next = new OffscreenCanvas(this.canvas.width, target);
        const nctx = this.context(next);
        nctx.drawImage(this.canvas, 0, 0);
        this.canvas.width = 0;
        this.canvas.height = 0;
        this.canvas = next;
        this.ctx = nctx;
    }

    async finalize(): Promise<Blob> {
        if (!this.canvas) throw new Error('Nothing was drawn');
        return this.canvas.convertToBlob({ type: 'image/png' });
    }

    private context(canvas: OffscreenCanvas): OffscreenCanvasRenderingContext2D {
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('OffscreenCanvas 2d context unavailable');
        return ctx;
    }

    private require(): OffscreenCanvasRenderingContext2D {
        if (!this.ctx) throw new Error('Stitcher canvas not allocated — call ensureHeight first');
        return this.ctx;
    }
}

function clampToBitmap(src: Rect, bitmap: ImageBitmap): Rect | null {
    const x0 = Math.max(0, src.x);
    const y0 = Math.max(0, src.y);
    const x1 = Math.min(bitmap.width, src.x + src.width);
    const y1 = Math.min(bitmap.height, src.y + src.height);
    if (x1 <= x0 || y1 <= y0) return null;
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}
