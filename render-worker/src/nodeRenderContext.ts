/**
 * Node.js implementation of RenderContext using @napi-rs/canvas.
 *
 * @napi-rs/canvas is a Rust-based Canvas implementation that provides
 * a CanvasRenderingContext2D-compatible API in Node.js. It's significantly
 * faster than node-canvas (C++ based) for our workload.
 *
 * The objects returned are structurally compatible with the DOM types
 * used by the shared painters (CanvasRenderingContext2D, CanvasImageSource).
 */

import { createCanvas, loadImage, type Canvas, type SKRSContext2D, type Image } from '@napi-rs/canvas';
import type { RenderContext, CanvasHandle } from '@shared/utils/renderContext';

export const nodeRenderContext: RenderContext = {
  createCanvas(w: number, h: number): CanvasHandle {
    const canvas = createCanvas(w, h);
    const ctx = canvas.getContext('2d');
    return {
      canvas: canvas as unknown as CanvasHandle['canvas'],
      ctx: ctx as unknown as CanvasRenderingContext2D,
    };
  },

  async loadImage(src: string): Promise<CanvasImageSource> {
    const image = await loadImage(src);
    return image as unknown as CanvasImageSource;
  },
};
