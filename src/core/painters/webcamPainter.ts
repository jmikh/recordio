import type { Size } from '../types';

/**
 * Draws the webcam overlay (Picture-in-Picture) onto the canvas.
 * 
 * @param ctx - The 2D rendering context.
 * @param video - The source video element for the webcam.
 * @param outputSize - The dimensions of the output canvas.
 * @param inputSize - The dimensions of the source webcam video.
 */
export function drawWebcam(
    ctx: CanvasRenderingContext2D,
    video: HTMLVideoElement,
    outputSize: Size,
    inputSize: Size
) {
    // Default behavior: Bottom Right, 20% width.
    // TODO: Move this layout logic to Track DisplaySettings in the future
    const pipWidth = outputSize.width * 0.2;
    // Maintain aspect ratio
    const scale = pipWidth / inputSize.width;
    const pipHeight = inputSize.height * scale;

    const padding = 20;
    const pipX = outputSize.width - pipWidth - padding;
    const pipY = outputSize.height - pipHeight - padding;

    ctx.save();

    // Draw Video
    ctx.drawImage(video, pipX, pipY, pipWidth, pipHeight);

    // Draw Border
    ctx.strokeStyle = "white";
    ctx.lineWidth = 4;
    ctx.strokeRect(pipX, pipY, pipWidth, pipHeight);

    ctx.restore();
}
