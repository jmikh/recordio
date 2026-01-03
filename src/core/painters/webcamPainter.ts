import type { CameraSettings, Size } from '../types';

const SHADOW_BLUR = 20;
const SHADOW_COLOR = 'rgba(0,0,0,0.5)';
const SHADOW_OFFSET_Y = 10;
const GLOW_BLUR = 25;

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
    video: HTMLVideoElement,
    inputSize: Size,
    settings: CameraSettings,
    globalScale: number = 1
) {
    const {
        x, y, width, height,
        shape = 'rect',
        borderRadius = 0,
        borderWidth = 0,
        borderColor = '#ffffff',
        hasShadow = false,
        hasGlow = false
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

    // Apply global scaling
    // Note: x, y, width, height are already projected/scaled by the caller if needed.
    // Here we primarily care about scaling the styles (border, shadow).

    // Scale Style Properties
    const scaledBorderWidth = borderWidth * globalScale;
    const scaledBorderRadius = borderRadius * globalScale;

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
                // Manually draw rounded rect for compatibility
                const r = Math.min(scaledBorderRadius, width / 2, height / 2);
                ctx.moveTo(x + r, y);
                ctx.lineTo(x + width - r, y);
                ctx.quadraticCurveTo(x + width, y, x + width, y + r);
                ctx.lineTo(x + width, y + height - r);
                ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
                ctx.lineTo(x + r, y + height);
                ctx.quadraticCurveTo(x, y + height, x, y + height - r);
                ctx.lineTo(x, y + r);
                ctx.quadraticCurveTo(x, y, x + r, y);
            } else {
                ctx.rect(x, y, width, height);
            }
        }
        ctx.closePath();
    };

    ctx.save();

    // 1. Glow Pass
    if (hasGlow) {
        ctx.save();
        ctx.shadowBlur = GLOW_BLUR * globalScale;
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
        ctx.shadowBlur = SHADOW_BLUR * globalScale;
        ctx.shadowColor = SHADOW_COLOR;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = SHADOW_OFFSET_Y * globalScale;
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
    // Draw Video
    ctx.drawImage(video, sx, sy, sw, sh, x, y, width, height);
    ctx.restore(); // Remove clip

    // 4. Border Pass
    if (scaledBorderWidth > 0) {
        definePath();
        ctx.lineWidth = scaledBorderWidth;
        ctx.strokeStyle = borderColor;
        ctx.stroke();
    }

    ctx.restore();
}
