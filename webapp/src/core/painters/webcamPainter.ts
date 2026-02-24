import type { CameraSettings, Size } from '../../types';

const REF_OUTPUT_HEIGHT = 1080;
const REF_SHADOW_BLUR = 20;
const SHADOW_COLOR = 'rgba(0,0,0,0.5)';
const REF_SHADOW_OFFSET_Y = 10;
const REF_GLOW_BLUR = 25;
const FEATHER_SIZE = 40;

// Canvas cache for feather effect (reuse to avoid creating new canvases every frame)
let cachedOffscreenCanvas: HTMLCanvasElement | null = null;
let cachedOffscreenCtx: CanvasRenderingContext2D | null = null;
let cachedMaskCanvas: HTMLCanvasElement | null = null;
let cachedMaskCtx: CanvasRenderingContext2D | null = null;
let cachedWidth = 0;
let cachedHeight = 0;
let cachedShape: 'circle' | 'rect' | 'square' | null = null;
let cachedMaskWidth = 0;
let cachedMaskHeight = 0;
let cachedMaskShape: 'circle' | 'rect' | 'square' | null = null;

/**
 * Draws the webcam overlay (Picture-in-Picture) onto the canvas.
 * 
 * @param ctx - The 2D rendering context.
 * @param video - The source video element for the webcam.
 * @param inputSize - The dimensions of the source webcam video.
 * @param settings - Configuration for position/size.
 */
export function drawWebcam(
    ctx: CanvasRenderingContext2D,
    video: HTMLVideoElement | VideoFrame,
    inputSize: Size,
    settings: CameraSettings,
    outputSize?: Size
) {
    const {
        xPx: x, yPx: y, widthPx: width, heightPx: height,
        shape = 'rect',
        borderRadiusPx: borderRadius = 0,
        borderWidthPx: borderWidth = 0,
        borderColor = '#ffffff',
        hasShadow = false,
        hasGlow = false,
        hasFeather = false,
        featherAmount = 0.15,
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

    // Scale effect properties relative to output height
    const effectScale = outputSize ? outputSize.height / REF_OUTPUT_HEIGHT : 1;

    // Scale Style Properties
    const scaledBorderWidth = borderWidth;

    // borderRadius is in output pixels — already scaled by ProjectImpl.scale
    const scaledBorderRadius = borderRadius;

    // Helper to create the path based on shape
    const definePath = () => {
        ctx.beginPath();
        if (shape === 'circle') {
            const centerX = x + width / 2;
            const centerY = y + height / 2;
            const radius = Math.min(width, height) / 2;
            ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
        } else {
            // Rect or Square
            if (scaledBorderRadius > 0) {
                // Use roundRect for true circular arcs matching CSS border-radius
                // Clamp to half of smaller dimension to avoid overlap
                const r = Math.min(scaledBorderRadius, width / 2, height / 2);
                ctx.roundRect(x, y, width, height, r);
            } else {
                ctx.rect(x, y, width, height);
            }
        }
        ctx.closePath();
    };


    ctx.save();

    // Apply mirror transformation if enabled
    if (mirrored) {
        ctx.translate(x + width, 0);
        ctx.scale(-1, 1);
        ctx.translate(-x, 0);
    }

    // 1. Glow Pass (only in border mode)
    if (hasGlow && !hasFeather) {
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

    // 2. Shadow Pass (only in border mode)
    if (hasShadow && !hasFeather) {
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
    if (hasFeather && featherAmount > 0) {
        // Feather mode: use off-screen canvas for clean compositing isolation
        // Reuse cached canvas if dimensions and shape match, otherwise create new one
        if (!cachedOffscreenCanvas || cachedWidth !== width || cachedHeight !== height || cachedShape !== shape) {
            cachedOffscreenCanvas = document.createElement('canvas');
            cachedOffscreenCanvas.width = width;
            cachedOffscreenCanvas.height = height;
            cachedOffscreenCtx = cachedOffscreenCanvas.getContext('2d')!;
            cachedWidth = width;
            cachedHeight = height;
            cachedShape = shape;
        }

        const offscreen = cachedOffscreenCanvas;
        const offCtx = cachedOffscreenCtx!;

        // Clear previous frame
        offCtx.clearRect(0, 0, width, height);
        offCtx.globalCompositeOperation = 'source-over';

        // Draw video to off-screen canvas at origin (0,0)
        offCtx.drawImage(video, sx, sy, sw, sh, 0, 0, width, height);

        // Apply feathered alpha mask using destination-in
        offCtx.globalCompositeOperation = 'destination-in';

        if (shape === 'circle') {
            const centerX = width / 2;
            const centerY = height / 2;
            const radius = Math.min(width, height) / 2;
            const featherSize = radius * featherAmount;
            const innerRadius = Math.max(0, radius - featherSize);

            // Radial gradient: opaque center, transparent edge
            const gradient = offCtx.createRadialGradient(
                centerX, centerY, innerRadius,
                centerX, centerY, radius
            );
            gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
            gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');

            offCtx.fillStyle = gradient;
            offCtx.fillRect(0, 0, width, height);
        } else {
            // For rect/square: build mask with faded edges
            const smallerDim = Math.min(width, height);
            const featherSize = smallerDim * featherAmount;

            // Reuse cached mask canvas if dimensions and shape match
            if (!cachedMaskCanvas || cachedMaskWidth !== width || cachedMaskHeight !== height || cachedMaskShape !== shape) {
                cachedMaskCanvas = document.createElement('canvas');
                cachedMaskCanvas.width = width;
                cachedMaskCanvas.height = height;
                cachedMaskCtx = cachedMaskCanvas.getContext('2d')!;
                cachedMaskWidth = width;
                cachedMaskHeight = height;
                cachedMaskShape = shape;
            }

            const maskCanvas = cachedMaskCanvas;
            const maskCtx = cachedMaskCtx!;

            // Clear and rebuild mask
            maskCtx.clearRect(0, 0, width, height);
            maskCtx.globalCompositeOperation = 'source-over';

            // Fill entire rect with opaque white first
            maskCtx.fillStyle = 'rgba(255, 255, 255, 1)';
            maskCtx.fillRect(0, 0, width, height);

            // Use destination-out to remove the edges with gradients
            maskCtx.globalCompositeOperation = 'destination-out';

            // Top edge fade (remove)
            let grad = maskCtx.createLinearGradient(0, 0, 0, featherSize);
            grad.addColorStop(0, 'rgba(0, 0, 0, 1)'); // Remove outer edge
            grad.addColorStop(1, 'rgba(0, 0, 0, 0)'); // Keep inner
            maskCtx.fillStyle = grad;
            maskCtx.fillRect(0, 0, width, featherSize);

            // Bottom edge fade (remove)
            grad = maskCtx.createLinearGradient(0, height, 0, height - featherSize);
            grad.addColorStop(0, 'rgba(0, 0, 0, 1)');
            grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
            maskCtx.fillStyle = grad;
            maskCtx.fillRect(0, height - featherSize, width, featherSize);

            // Left edge fade (remove)
            grad = maskCtx.createLinearGradient(0, 0, featherSize, 0);
            grad.addColorStop(0, 'rgba(0, 0, 0, 1)');
            grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
            maskCtx.fillStyle = grad;
            maskCtx.fillRect(0, 0, featherSize, height);

            // Right edge fade (remove)
            grad = maskCtx.createLinearGradient(width, 0, width - featherSize, 0);
            grad.addColorStop(0, 'rgba(0, 0, 0, 1)');
            grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
            maskCtx.fillStyle = grad;
            maskCtx.fillRect(width - featherSize, 0, featherSize, height);

            // Apply the completed mask to the video with destination-in
            offCtx.globalCompositeOperation = 'destination-in';
            offCtx.drawImage(maskCanvas, 0, 0);
        }

        // Copy the feathered result to the main canvas
        ctx.drawImage(offscreen, 0, 0, width, height, x, y, width, height);
    } else {
        // No feather: draw directly to main canvas with standard clipping
        ctx.save();
        definePath();
        ctx.clip();
        ctx.drawImage(video, sx, sy, sw, sh, x, y, width, height);
        ctx.restore();
    }

    // 4. Border Pass (only in border mode)
    if (scaledBorderWidth > 0 && !hasFeather) {
        definePath();
        ctx.lineWidth = scaledBorderWidth;
        ctx.strokeStyle = borderColor;
        ctx.stroke();
    }

    ctx.restore();
}
