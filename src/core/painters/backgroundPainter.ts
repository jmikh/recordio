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
    // 2. Gradient
    else if (settings.backgroundType === 'gradient' && settings.backgroundGradient) {
        const { colors, direction } = settings.backgroundGradient;
        const w = canvas.width;
        const h = canvas.height;
        let x0 = 0, y0 = 0, x1 = 0, y1 = 0;

        switch (direction) {
            case 'N': x0 = w / 2; y0 = h; x1 = w / 2; y1 = 0; break;
            case 'NE': x0 = 0; y0 = h; x1 = w; y1 = 0; break;
            case 'E': x0 = 0; y0 = h / 2; x1 = w; y1 = h / 2; break;
            case 'SE': x0 = 0; y0 = 0; x1 = w; y1 = h; break; // Top-Left to Bottom-Right
            case 'S': x0 = w / 2; y0 = 0; x1 = w / 2; y1 = h; break; // Top to Bottom
            case 'SW': x0 = w; y0 = 0; x1 = 0; y1 = h; break;
            case 'W': x0 = w; y0 = h / 2; x1 = 0; y1 = h / 2; break;
            case 'NW': x0 = w; y0 = h; x1 = 0; y1 = 0; break;
        }

        const gradient = ctx.createLinearGradient(x0, y0, x1, y1);
        gradient.addColorStop(0, colors[0]);
        gradient.addColorStop(1, colors[1]);

        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, w, h);
    }
    // 3. Image (Cover Mode)
    else if (settings.backgroundType === 'image' && bgImage) {
        if (bgImage.complete && bgImage.naturalWidth > 0) {
            const imgW = bgImage.naturalWidth;
            const imgH = bgImage.naturalHeight;
            const canvasW = canvas.width;
            const canvasH = canvas.height;




            let drawW = canvasW;
            let drawH = canvasH;
            let offsetX = 0;
            let offsetY = 0;

            // "Cover" Logic: Zoom to fill entire canvas without stretching
            // If we have blur, we need to overdraw by the blur radius to avoid darkening edges
            const blurRadius = settings.backgroundBlur || 0;
            const safeMargin = blurRadius * 3; // 3x to be safe from any vignette

            // We effectively want to cover a slightly larger rectangle
            const targetW = canvasW + (safeMargin * 2);
            const targetH = canvasH + (safeMargin * 2);

            // Calculate scale to cover the target area
            const scale = Math.max(targetW / imgW, targetH / imgH);

            drawW = imgW * scale;
            drawH = imgH * scale;

            // Center (relative to real canvas)
            offsetX = (canvasW - drawW) / 2;
            offsetY = (canvasH - drawH) / 2;

            // Apply Blur
            if (blurRadius > 0) {
                ctx.filter = `blur(${blurRadius}px)`;
            }

            ctx.drawImage(bgImage, offsetX, offsetY, drawW, drawH);

            // Reset Filter
            ctx.filter = 'none';
        }
    }
};
