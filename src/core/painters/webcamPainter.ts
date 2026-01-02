import type { Size, CameraSettings } from '../types';

/**
 * Draws the webcam overlay (Picture-in-Picture) onto the canvas.
 * 
 * @param ctx - The 2D rendering context.
 * @param video - The source video element for the webcam.
 * @param outputSize - The dimensions of the output canvas.
 * @param inputSize - The dimensions of the source webcam video.
 * @param settings - Optional config for position/size.
 */
export function drawWebcam(
    ctx: CanvasRenderingContext2D,
    video: HTMLVideoElement,
    outputSize: Size,
    inputSize: Size,
    settings?: CameraSettings
) {
    let pipX, pipY, pipWidth, pipHeight, shape;

    if (settings) {
        pipX = settings.x;
        pipY = settings.y;
        pipWidth = settings.width;
        pipHeight = settings.height;
        shape = settings.shape || 'rect';
    } else {
        // Default behavior: Bottom Right, 20% width.
        pipWidth = outputSize.width * 0.2;
        // Maintain aspect ratio
        const scale = pipWidth / inputSize.width;
        pipHeight = inputSize.height * scale;

        const padding = 20;
        pipX = outputSize.width - pipWidth - padding;
        pipY = outputSize.height - pipHeight - padding;
        shape = 'rect';
    }

    ctx.save();

    if (shape === 'circle') {
        ctx.beginPath();
        const centerX = pipX + pipWidth / 2;
        const centerY = pipY + pipHeight / 2;
        const radius = Math.min(pipWidth, pipHeight) / 2;
        ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
        ctx.clip();
    }

    // Draw Video
    ctx.drawImage(video, pipX, pipY, pipWidth, pipHeight);

    // Draw Border
    ctx.strokeStyle = "white";
    ctx.lineWidth = 4;

    if (shape === 'circle') {
        const centerX = pipX + pipWidth / 2;
        const centerY = pipY + pipHeight / 2;
        const radius = Math.min(pipWidth, pipHeight) / 2;
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
        ctx.stroke();
    } else {
        ctx.strokeRect(pipX, pipY, pipWidth, pipHeight);
    }

    ctx.restore();
}
