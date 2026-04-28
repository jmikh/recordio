/**
 * Re-export shared interfaces + browser-specific implementation.
 */

export type { RenderContext, CanvasHandle } from '@shared/utils/renderContext';

import type { RenderContext, CanvasHandle } from '@shared/utils/renderContext';

/** Browser-native implementation — uses OffscreenCanvas + Image. */
export const browserRenderContext: RenderContext = {
  createCanvas(w: number, h: number): CanvasHandle {
    const canvas = new OffscreenCanvas(w, h);
    return { canvas, ctx: canvas.getContext('2d')! as unknown as CanvasRenderingContext2D };
  },
  loadImage(src: string): Promise<CanvasImageSource> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      if (!src.startsWith('blob:')) {
        img.crossOrigin = 'anonymous';
      }
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  },
};
