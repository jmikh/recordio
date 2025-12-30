import type { ProjectSettings } from '../types';

/**
 * Draws the project background (solid color or image) onto the canvas.
 */
export const drawBackground = (
    ctx: CanvasRenderingContext2D,
    settings: ProjectSettings,
    canvas: HTMLCanvasElement,
    bgImage: HTMLImageElement | null
) => {
    // 1. Solid Color
    if (settings.backgroundType === 'solid' && settings.backgroundColor) {
        ctx.fillStyle = settings.backgroundColor;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    // 2. Image (Cover Mode)
    else if (settings.backgroundType === 'image' && bgImage && settings.backgroundImageUrl) {
        if (bgImage.complete && bgImage.naturalWidth > 0) {
            const imgW = bgImage.naturalWidth;
            const imgH = bgImage.naturalHeight;
            const canvasW = canvas.width;
            const canvasH = canvas.height;

            const imgRatio = imgW / imgH;
            const canvasRatio = canvasW / canvasH;

            let drawW = canvasW;
            let drawH = canvasH;
            let offsetX = 0;
            let offsetY = 0;

            // "Cover" Logic: Zoom to fill entire canvas without stretching
            if (imgRatio > canvasRatio) {
                // Image is wider than canvas (relatively) -> constrained by Height
                // Scale image so Height matches Canvas Height
                drawH = canvasH;
                drawW = drawH * imgRatio;

                // Center horizontally
                offsetX = -(drawW - canvasW) / 2;
            } else {
                // Image is taller/narrower -> constrained by Width
                // Scale image so Width matches Canvas Width
                drawW = canvasW;
                drawH = drawW / imgRatio;

                // Center vertically
                offsetY = -(drawH - canvasH) / 2;
            }

            ctx.drawImage(bgImage, offsetX, offsetY, drawW, drawH);
        }
    }
};
