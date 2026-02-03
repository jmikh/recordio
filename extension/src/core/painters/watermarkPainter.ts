/**
 * Draws a watermark logo in the top-right corner of the canvas.
 * Used for non-subscribed users during video export.
 */
export function drawWatermark(
    ctx: CanvasRenderingContext2D,
    watermarkImg: HTMLImageElement,
    canvasWidth: number
): void {
    // Logo takes 15% of canvas width, maintaining aspect ratio
    const logoWidth = canvasWidth * 0.15;
    const aspectRatio = watermarkImg.naturalHeight / watermarkImg.naturalWidth;
    const logoHeight = logoWidth * aspectRatio;

    // Padding from edges (scaled based on 1920px reference)
    const scaleFactor = canvasWidth / 1920;
    const padding = 30 * scaleFactor;
    const bgPadding = 12 * scaleFactor;
    const borderRadius = 8 * scaleFactor;

    // Position at top-right corner
    const logoX = canvasWidth - logoWidth - padding;
    const logoY = padding;

    // Draw rounded black background with 80% opacity
    const bgX = logoX - bgPadding;
    const bgY = logoY - bgPadding;
    const bgWidth = logoWidth + bgPadding * 2;
    const bgHeight = logoHeight + bgPadding * 2;

    ctx.save();
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = '#000000';
    ctx.beginPath();
    ctx.roundRect(bgX, bgY, bgWidth, bgHeight, borderRadius);
    ctx.fill();
    ctx.restore();

    // Draw the logo on top
    ctx.drawImage(watermarkImg, logoX, logoY, logoWidth, logoHeight);
}
