import type { CameraSettings, Size } from '../types';

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
    settings: CameraSettings
) {
    let pipX, pipY, pipWidth, pipHeight, shape;

    pipX = settings.x;
    pipY = settings.y;
    pipWidth = settings.width;
    pipHeight = settings.height;
    shape = settings.shape || 'rect';

    // Calculate Crop (Object-Fit: Cover)
    // We want to map a portion of inputSize (src) to pipWidth/Height (dst)
    // such that the src portion fills the dst without distortion.

    const srcRatio = inputSize.width / inputSize.height;
    const dstRatio = pipWidth / pipHeight;

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

    ctx.save();

    // 1. Define Clip Path
    ctx.beginPath();
    if (shape === 'circle') {
        const centerX = pipX + pipWidth / 2;
        const centerY = pipY + pipHeight / 2;
        const radius = Math.min(pipWidth, pipHeight) / 2;
        ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    } else {
        // Rect and Square use standard rect clip
        ctx.rect(pipX, pipY, pipWidth, pipHeight);
    }
    ctx.clip();

    // 2. Draw Video (Clipped)
    ctx.drawImage(video, sx, sy, sw, sh, pipX, pipY, pipWidth, pipHeight);

    // 3. Draw Border
    ctx.strokeStyle = "white";
    ctx.lineWidth = 4;

    // We can just stroke the current path if we want, but let's be explicit to match previous style logic
    // Actually, stroking the current clipped path is dangerous if the clip was complex, 
    // but here it is simple. However, 'clip' consumes the path. We need to beginPath again.

    ctx.beginPath();
    if (shape === 'circle') {
        const centerX = pipX + pipWidth / 2;
        const centerY = pipY + pipHeight / 2;
        const radius = Math.min(pipWidth, pipHeight) / 2;
        ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    } else {
        ctx.rect(pipX, pipY, pipWidth, pipHeight);
    }
    ctx.stroke();

    ctx.restore();
}
