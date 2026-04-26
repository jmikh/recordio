import type { BackgroundSettings, Size } from '../types';

const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const isValidHexColor = (color: string): boolean => HEX_RE.test(color);

/**
 * Draws the project background (solid color or image) onto the canvas.
 */
export const drawBackground = (
    ctx: CanvasRenderingContext2D,
    background: BackgroundSettings,
    blurRadius: number,
    canvasSize: Size,
    bgImage: CanvasImageSource | null
) => {
    const { width, height } = canvasSize;

    // 1. Solid Color
    if (background.type === 'color' && background.colorMode === 'solid' && background.color) {
        if (!isValidHexColor(background.color)) {
            console.error(`[backgroundPainter] Invalid solid color: "${background.color}"`);
            return;
        }
        ctx.fillStyle = background.color;
        ctx.fillRect(0, 0, width, height);
    }
    // 2. Gradient
    else if (background.type === 'color' && background.colorMode === 'gradient') {
        const { gradientColors, gradientDirection } = background;

        // Convert CSS gradient angle to canvas coordinates
        // CSS: 0° = up, 90° = right, 180° = down, 270° = left
        // Canvas: calculate start/end points based on angle
        const angleRad = (gradientDirection - 90) * (Math.PI / 180);
        const diagonal = Math.sqrt(width * width + height * height) / 2;
        const centerX = width / 2;
        const centerY = height / 2;

        // Calculate gradient line endpoints
        const x0 = centerX - Math.cos(angleRad) * diagonal;
        const y0 = centerY - Math.sin(angleRad) * diagonal;
        const x1 = centerX + Math.cos(angleRad) * diagonal;
        const y1 = centerY + Math.sin(angleRad) * diagonal;

        const gradient = ctx.createLinearGradient(x0, y0, x1, y1);
        const color0 = isValidHexColor(gradientColors[0]) ? gradientColors[0] : '#000000';
        const color1 = isValidHexColor(gradientColors[1]) ? gradientColors[1] : '#000000';
        if (color0 !== gradientColors[0] || color1 !== gradientColors[1]) {
            console.error(`[backgroundPainter] Invalid gradient color: "${gradientColors[0]}", "${gradientColors[1]}"`);
        }
        gradient.addColorStop(0, color0);
        gradient.addColorStop(1, color1);

        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);
    }
    // 3. Image (Cover Mode) - for both preset and custom backgrounds
    else if ((background.type === 'preset' || background.type === 'custom') && bgImage) {
        // Extract image dimensions — works for HTMLImageElement, ImageBitmap, etc.
        const imgW = 'naturalWidth' in bgImage ? (bgImage as HTMLImageElement).naturalWidth : (bgImage as ImageBitmap).width;
        const imgH = 'naturalHeight' in bgImage ? (bgImage as HTMLImageElement).naturalHeight : (bgImage as ImageBitmap).height;
        const isReady = 'complete' in bgImage ? (bgImage as HTMLImageElement).complete : true;

        if (isReady && imgW > 0) {
            let drawW = width;
            let drawH = height;
            let offsetX = 0;
            let offsetY = 0;

            // "Cover" Logic: Zoom to fill entire canvas without stretching
            // If we have blur, we need to overdraw by the blur radius to avoid darkening edges
            const safeMargin = blurRadius * 3; // 3x to be safe from any vignette

            // We effectively want to cover a slightly larger rectangle
            const targetW = width + (safeMargin * 2);
            const targetH = height + (safeMargin * 2);

            // Calculate scale to cover the target area
            const scale = Math.max(targetW / imgW, targetH / imgH);

            drawW = imgW * scale;
            drawH = imgH * scale;

            // Center (relative to real canvas)
            offsetX = (width - drawW) / 2;
            offsetY = (height - drawH) / 2;

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
