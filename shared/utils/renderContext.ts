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
