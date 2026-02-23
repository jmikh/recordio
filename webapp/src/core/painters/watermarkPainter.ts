export type WatermarkPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

/**
 * Draws a pre-rendered watermark image at the specified corner of the canvas.
 * All sizing scales proportionally based on a 1920px reference width.
 */
export function drawWatermark(
    ctx: CanvasRenderingContext2D,
    watermarkImg: HTMLImageElement,
    canvasWidth: number,
    canvasHeight?: number,
    position: WatermarkPosition = 'top-right'
): void {
    const h = canvasHeight ?? canvasWidth;

    // Watermark height = 12% of canvas height, maintain aspect ratio
    const wmHeight = h * 0.12;
    const aspect = watermarkImg.naturalWidth / watermarkImg.naturalHeight;
    const wmWidth = wmHeight * aspect;

    // Padding from edges (scaled from 1080px reference height)
    const scaleFactor = h / 1080;
    const padding = 20 * scaleFactor;

    // Compute position
    let x: number;
    let y: number;

    switch (position) {
        case 'top-left':
            x = padding;
            y = padding;
            break;
        case 'top-right':
            x = canvasWidth - wmWidth - padding;
            y = padding;
            break;
        case 'bottom-left':
            x = padding;
            y = h - wmHeight - padding;
            break;
        case 'bottom-right':
            x = canvasWidth - wmWidth - padding;
            y = h - wmHeight - padding;
            break;
    }

    // Draw with rounded corners
    const borderRadius = 12 * scaleFactor;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, wmWidth, wmHeight, borderRadius);
    ctx.clip();
    ctx.drawImage(watermarkImg, x, y, wmWidth, wmHeight);
    ctx.restore();
}
