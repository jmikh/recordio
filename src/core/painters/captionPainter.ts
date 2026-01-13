import type { Captions, Size, CaptionSettings, OutputWindow } from '../types';
import { CaptionTimeMapper } from '../CaptionTimeMapper';
import { TimeMapper } from '../timeMapper';

/**
 * Draws captions at the bottom of the canvas.
 *
 * @param ctx 2D Canvas Context
 * @param captions Caption data from transcription
 * @param settings Caption display settings
 * @param outputWindows Output windows for time mapping
 * @param currentTimeMs Current output time
 * @param outputSize Size of the output canvas
 */
export function drawCaptions(
    ctx: CanvasRenderingContext2D,
    captions: Captions | undefined,
    settings: CaptionSettings,
    outputWindows: OutputWindow[],
    currentTimeMs: number,
    outputSize: Size
) {
    // Don't render if captions are disabled or missing
    if (!settings.visible || !captions || captions.segments.length === 0) {
        return;
    }

    // Create caption time mapper
    const timeMapper = new TimeMapper(outputWindows);
    const captionTimeMapper = new CaptionTimeMapper(captions.segments, timeMapper);

    // Get visible captions at current time
    const visibleCaptions = captionTimeMapper.getCaptionsAtOutputTime(currentTimeMs);

    if (visibleCaptions.length === 0) {
        return;
    }

    // Drawing Settings
    const fontSize = settings.size;
    const paddingX = 32;
    const paddingY = 16;
    const cornerRadius = 12;
    const marginBottom = outputSize.height * 0.02; // 2% from bottom of canvas
    const maxWidth = outputSize.width * 0.75; // 75% of canvas width

    ctx.save();

    // Font Setup
    ctx.font = `600 ${fontSize}px Satoshi, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';

    // Stack multiple captions vertically (though typically there's only one)
    // Start from the bottom - this is where the bottom of the first caption box will be
    let boxBottomY = outputSize.height - marginBottom;

    for (const caption of visibleCaptions) {
        const text = caption.text;

        // Word wrap the text if it exceeds maxWidth
        const lines = wrapText(ctx, text, maxWidth - (paddingX * 2));

        // Calculate box dimensions
        const lineHeight = fontSize * 1.4;
        const textHeight = lines.length * lineHeight;
        const boxHeight = textHeight + (paddingY * 2);

        // Measure the widest line for box width
        let maxLineWidth = 0;
        for (const line of lines) {
            const metrics = ctx.measureText(line);
            maxLineWidth = Math.max(maxLineWidth, metrics.width);
        }
        const boxWidth = maxLineWidth + (paddingX * 2);

        const x = outputSize.width / 2;
        const boxX = x - boxWidth / 2;
        // Calculate top of box from bottom position
        const boxY = boxBottomY - boxHeight;

        // Draw Background Box with backdrop blur effect
        ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.lineWidth = 1;

        ctx.beginPath();
        if (typeof ctx.roundRect === 'function') {
            ctx.roundRect(boxX, boxY, boxWidth, boxHeight, cornerRadius);
        } else {
            ctx.rect(boxX, boxY, boxWidth, boxHeight);
        }
        ctx.fill();
        ctx.stroke();

        // Draw Text with shadow
        ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
        ctx.shadowBlur = 4;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 1;
        ctx.fillStyle = 'rgba(255, 255, 255, 1)';

        // Draw each line
        let lineY = boxY + paddingY + lineHeight / 2;
        for (const line of lines) {
            ctx.fillText(line, x, lineY);
            lineY += lineHeight;
        }

        // Move up for next caption (if any)
        // Next caption's bottom will be above current box top with a 16px gap
        boxBottomY = boxY - 16;
    }

    ctx.restore();
}

/**
 * Wraps text to fit within a maximum width.
 * Returns an array of lines.
 */
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
    const words = text.split(' ');
    const lines: string[] = [];
    let currentLine = '';

    for (const word of words) {
        const testLine = currentLine ? `${currentLine} ${word}` : word;
        const metrics = ctx.measureText(testLine);

        if (metrics.width > maxWidth && currentLine) {
            lines.push(currentLine);
            currentLine = word;
        } else {
            currentLine = testLine;
        }
    }

    if (currentLine) {
        lines.push(currentLine);
    }

    return lines.length > 0 ? lines : [text];
}
