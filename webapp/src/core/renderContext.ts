/**
 * Abstraction over browser canvas/image APIs so painters can run
 * in environments without DOM (e.g. Node.js with node-canvas).
 */

import type { Size } from '../types';

export interface RenderContext {
  createCanvas(width: number, height: number): CanvasHandle;
  loadImage(src: string): Promise<CanvasImageSource>;
}

export interface CanvasHandle {
  canvas: CanvasImageSource & Size;
  ctx: CanvasRenderingContext2D;
}

/** Browser-native implementation — uses OffscreenCanvas + Image. */
export const browserRenderContext: RenderContext = {
  createCanvas(w: number, h: number): CanvasHandle {
    const canvas = new OffscreenCanvas(w, h);
    return { canvas, ctx: canvas.getContext('2d')! as unknown as CanvasRenderingContext2D };
  },
  loadImage(src: string): Promise<CanvasImageSource> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  },
};
