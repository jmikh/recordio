import type { CameraSettings, Size } from '../types';
import type { CameraImage } from './cameraCutout';
import { roundRectPath } from './utils/roundRect';
import { applyStyleEffect } from './utils/outlineEffects';

const REF_OUTPUT_HEIGHT = 1080;

/** Scratch canvas the background-removal transition is composed on — reused across calls (never displayed). */
let blendCanvas: OffscreenCanvas | HTMLCanvasElement | null | undefined;

function getBlendCanvas(width: number, height: number): OffscreenCanvas | HTMLCanvasElement | null {
    if (blendCanvas === undefined) {
        blendCanvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(width, height)
            : typeof document !== 'undefined' ? document.createElement('canvas')
                : null;
    }
    if (!blendCanvas) return null;
    // Grow only: the box resizes every frame of a transition
    if (blendCanvas.width < width) blendCanvas.width = width;
    if (blendCanvas.height < height) blendCanvas.height = height;
    return blendCanvas;
}

/**
 * The camera part-way between drawn with its background (amount 0) and the
 * cutout (amount 1), composed at (0, 0) of the box size: the background
 * fades with the shape it was clipped to, the person stays solid inside it,
 * and the parts of the person the shape cropped (a circle cuts off the
 * head) fade in. Null when no scratch canvas is available.
 */
function composeCutoutBlend(
    video: CanvasImageSource,
    cutout: CanvasImageSource,
    crop: { sx: number, sy: number, sw: number, sh: number },
    width: number,
    height: number,
    radius: number,
    amount: number,
): OffscreenCanvas | HTMLCanvasElement | null {
    const canvas = getBlendCanvas(Math.ceil(width), Math.ceil(height));
    const bctx = canvas?.getContext('2d') as CanvasRenderingContext2D | null | undefined;
    if (!canvas || !bctx) return null;
    const { sx, sy, sw, sh } = crop;

    bctx.save();
    bctx.clearRect(0, 0, Math.ceil(width), Math.ceil(height));

    bctx.save();
    roundRectPath(bctx, 0, 0, width, height, radius);
    bctx.clip();
    bctx.globalAlpha = 1 - amount;
    bctx.drawImage(video, sx, sy, sw, sh, 0, 0, width, height);
    bctx.globalAlpha = 1;
    bctx.drawImage(cutout, sx, sy, sw, sh, 0, 0, width, height);
    bctx.restore();

    // Outside the shape only: the box minus the rounded shape
    roundRectPath(bctx, 0, 0, width, height, radius);
    bctx.rect(0, 0, width, height);
    bctx.clip('evenodd');
    bctx.globalAlpha = amount;
    bctx.drawImage(cutout, sx, sy, sw, sh, 0, 0, width, height);
    bctx.restore();

    return canvas;
}

/**
 * Draws the camera overlay (Picture-in-Picture) onto the canvas.
 *
 * @param ctx - The 2D rendering context.
 * @param camera - The camera frame and, while the background is removed,
 *   its transparent cutout (shared/painters/cameraCutout.ts). At
 *   cutoutAmount 1 the cutout is drawn free-standing, without the shape
 *   clip, and the glow or shadow follows the silhouette; between 0 and 1
 *   it's blended with the clipped frame (composeCutoutBlend).
 * @param inputSize - The dimensions of the source camera video.
 * @param settings - Configuration for position/size.
 */
export function drawCamera(
    ctx: CanvasRenderingContext2D,
    camera: CameraImage,
    inputSize: Size,
    settings: CameraSettings,
    outputSize?: Size
) {
    const {
        xPx: x, yPx: y, widthPx: width, heightPx: height,
        borderRadiusPx: borderRadius = 0,
        cropZoom = 1,
        mirrored = false
    } = settings;

    // Calculate Crop (Object-Fit: Cover)
    const srcRatio = inputSize.width / inputSize.height;
    const dstRatio = width / height;

    let sx, sy, sw, sh;

    if (srcRatio > dstRatio) {
        // Source is wider than destination. Crop left/right.
        sh = inputSize.height;
        sw = inputSize.height * dstRatio;
        sx = (inputSize.width - sw) / 2;
        sy = 0;
    } else {
        // Source is taller than destination. Crop top/bottom.
        sw = inputSize.width;
        sh = inputSize.width / dstRatio;
        sx = 0;
        sy = (inputSize.height - sh) / 2;
    }

    // Apply Crop Zoom (zooms within the camera feed)
    if (cropZoom > 1) {
        const zoomedW = sw / cropZoom;
        const zoomedH = sh / cropZoom;
        sx += (sw - zoomedW) / 2;
        sy += (sh - zoomedH) / 2;
        sw = zoomedW;
        sh = zoomedH;
    }

    // Apply Face Anchor Centering if defined
    if (settings.faceCenter) {
        // faceCenter is normalized [0, 1] relative to inputSize
        const fcX = settings.faceCenter.x * inputSize.width;
        const fcY = settings.faceCenter.y * inputSize.height;

        sx = fcX - (sw / 2);
        sy = fcY - (sh / 2);

        // Clamp to ensure we don't draw outside source video bounds and show empty pixels
        sx = Math.max(0, Math.min(sx, inputSize.width - sw));
        sy = Math.max(0, Math.min(sy, inputSize.height - sh));
    }

    // Scale effect properties relative to output height
    const effectScale = outputSize ? outputSize.height / REF_OUTPUT_HEIGHT : 1;

    // The shadow always falls downward, leaning toward the canvas center by how
    // far the camera sits from it: straight down at the center, 45° at an edge.
    // The editor overlays pass no outputSize, but their canvas is output-sized
    const halfCanvasWidth = (outputSize ?? ctx.canvas).width / 2;
    const shadowDirection = {
        x: (halfCanvasWidth - (x + width / 2)) / halfCanvasWidth,
        y: 1,
    };

    // borderRadius is in output pixels — already scaled by ProjectImpl.scale
    const scaledBorderRadius = borderRadius;

    // Helper to create the clipping path
    // Always use borderRadius for rendering — the resolver converts shape to
    // effective radius (circle = min(w,h)/2) and interpolates during transitions.
    // Shape is only used by the bounding box for aspect ratio constraints.
    const definePath = () => {
        const r = Math.min(scaledBorderRadius, width / 2, height / 2);
        if (r > 0) {
            roundRectPath(ctx, x, y, width, height, r);
        } else {
            ctx.beginPath();
            ctx.rect(x, y, width, height);
            ctx.closePath();
        }
    };


    ctx.save();

    // Apply mirror transformation if enabled
    if (mirrored) {
        ctx.translate(x + width, 0);
        ctx.scale(-1, 1);
        ctx.translate(-x, 0);
    }

    const video = camera.image;
    const cutout = camera.cutout;
    const cutoutAmount = cutout ? camera.cutoutAmount : 0;

    if (cutout && cutoutAmount > 0 && cutoutAmount < 1) {
        const r = Math.min(scaledBorderRadius, width / 2, height / 2);
        const blend = composeCutoutBlend(video, cutout, { sx, sy, sw, sh }, width, height, r, cutoutAmount);
        if (blend) {
            // The shadow is cast from the blend's alpha: the fading shape plus the silhouette
            applyStyleEffect(ctx, settings, effectScale, shadowDirection);
            ctx.drawImage(blend, 0, 0, width, height, x, y, width, height);
            ctx.restore();
            return;
        }
    }

    // Without a scratch canvas the transition snaps halfway
    if (cutout && cutoutAmount >= 0.5) {
        // The canvas shadow is cast from the image's alpha, so it traces the silhouette
        applyStyleEffect(ctx, settings, effectScale, shadowDirection);
        ctx.drawImage(cutout, sx, sy, sw, sh, x, y, width, height);
        ctx.restore();
        return;
    }

    // 1. Glow/Shadow Pass — the caster is just the filled shape
    ctx.save();
    const casterFill = applyStyleEffect(ctx, settings, effectScale, shadowDirection);
    if (casterFill) {
        definePath();
        ctx.fillStyle = casterFill;
        ctx.fill();
    }
    ctx.restore();

    // 2. Content Pass
    ctx.save();
    definePath();
    ctx.clip();
    ctx.drawImage(video, sx, sy, sw, sh, x, y, width, height);
    ctx.restore();

    ctx.restore();
}
