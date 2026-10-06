import type { CameraSettings, Size } from '../types';
import { roundRectPath } from './utils/roundRect';

const REF_OUTPUT_HEIGHT = 1080;
const REF_SHADOW_BLUR = 20;
const SHADOW_COLOR = 'rgba(0,0,0,0.5)';
const REF_SHADOW_OFFSET_Y = 10;
const REF_GLOW_BLUR = 25;

/**
 * Draws the camera overlay (Picture-in-Picture) onto the canvas.
 * 
 * @param ctx - The 2D rendering context.
 * @param video - The source video element for the camera.
 * @param inputSize - The dimensions of the source camera video.
 * @param settings - Configuration for position/size.
 * @param cutout - `video` is a transparent background-removed cutout
 *   (shared/painters/cameraCutout.ts): drawn free-standing, without the
 *   shape clip, border or glow; the shadow follows the silhouette.
 */
export function drawCamera(
    ctx: CanvasRenderingContext2D,
    video: CanvasImageSource,
    inputSize: Size,
    settings: CameraSettings,
    outputSize?: Size,
    cutout = false
) {
    const {
        xPx: x, yPx: y, widthPx: width, heightPx: height,
        borderRadiusPx: borderRadius = 0,
        borderWidthPx: borderWidth = 0,
        borderColor = '#ffffff',
        hasShadow = false,
        hasGlow = false,
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

    // Scale Style Properties
    const scaledBorderWidth = borderWidth;

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

    if (cutout) {
        if (hasShadow) {
            ctx.shadowBlur = REF_SHADOW_BLUR * effectScale;
            ctx.shadowColor = SHADOW_COLOR;
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = REF_SHADOW_OFFSET_Y * effectScale;
        }
        ctx.drawImage(video, sx, sy, sw, sh, x, y, width, height);
        ctx.restore();
        return;
    }

    // 1. Glow Pass
    if (hasGlow) {
        ctx.save();
        ctx.shadowBlur = REF_GLOW_BLUR * effectScale;
        ctx.shadowColor = borderColor;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
        definePath();

        ctx.fillStyle = borderColor;
        ctx.fill();

        if (scaledBorderWidth > 0) {
            ctx.lineWidth = scaledBorderWidth;
            ctx.strokeStyle = borderColor;
            ctx.stroke();
        }
        ctx.restore();
    }

    // 2. Shadow Pass
    if (hasShadow) {
        ctx.save();
        ctx.shadowBlur = REF_SHADOW_BLUR * effectScale;
        ctx.shadowColor = SHADOW_COLOR;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = REF_SHADOW_OFFSET_Y * effectScale;
        definePath();

        ctx.fillStyle = 'black';
        ctx.fill();

        if (scaledBorderWidth > 0) {
            ctx.lineWidth = scaledBorderWidth;
            ctx.strokeStyle = 'black'; // Color doesn't matter for shadow caster, but stroke needs color
            ctx.stroke();
        }
        ctx.restore();
    }

    // 3. Content Pass
    ctx.save();
    definePath();
    ctx.clip();
    ctx.drawImage(video, sx, sy, sw, sh, x, y, width, height);
    ctx.restore();

    // 4. Border Pass
    if (scaledBorderWidth > 0) {
        definePath();
        ctx.lineWidth = scaledBorderWidth;
        ctx.strokeStyle = borderColor;
        ctx.stroke();
    }

    ctx.restore();
}
