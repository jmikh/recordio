import type { Size, CaptionSettings, CaptionSegment } from '../../types';

// ══════════════════════════════════════════
// Reference Constants (designed for 1080px height)
// ══════════════════════════════════════════

const REF_OUTPUT_HEIGHT = 1080;
const REF_FONT_SIZE = 50;
const REF_PADDING_X = 32;
const REF_PADDING_Y = 16;
const REF_CORNER_RADIUS = 12;

/** Opacity for non-highlighted words */
const DIM_OPACITY = 0.6;

/** Default caption text color */
const DEFAULT_TEXT_COLOR = '#ffffff';

/**
 * Convert hex color string + opacity to rgba() for canvas rendering.
 * Supports 6-char (#rrggbb) and 8-char (#rrggbbaa) hex strings.
 * When an 8-char hex is provided, the embedded alpha is multiplied with the opacity parameter.
 */
function hexToRgba(hex: string, opacity: number): string {
    const clean = hex.replace('#', '');
    const r = parseInt(clean.substring(0, 2), 16);
    const g = parseInt(clean.substring(2, 4), 16);
    const b = parseInt(clean.substring(4, 6), 16);
    let a = opacity;
    if (clean.length === 8) {
        const hexAlpha = parseInt(clean.substring(6, 8), 16) / 255;
        a = hexAlpha * opacity;
    }
    return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/**
 * Draws captions at the bottom of the canvas with progressive word highlighting.
 *
 * @param ctx 2D Canvas Context
 * @param captionSegments Caption segments from transcription (with source timestamps)
 * @param settings Caption display settings
 * @param timeMapper Time mapper for source-to-output time conversion
 * @param currentTimeMs Current output time
 * @param outputSize Size of the output canvas
 */
export function drawCaptions(
    ctx: CanvasRenderingContext2D,
    captionSegments: CaptionSegment[],
    settings: CaptionSettings,
    currentTimeMs: number,
    outputSize: Size
) {
    // Don't render if captions are disabled or missing
    if (!settings.visible || !captionSegments || captionSegments.length === 0) {
        return;
    }

    // Get captions active at current time using cached output times
    const visibleCaptions = captionSegments.filter(segment =>
        segment.visible &&
        currentTimeMs >= segment.outputStartTimeMs &&
        currentTimeMs < segment.outputEndTimeMs
    );

    if (visibleCaptions.length === 0) {
        return;
    }

    // Drawing Settings — scale by output height and captionSize multiplier
    const scale = outputSize.height / REF_OUTPUT_HEIGHT;
    const fontSize = Math.round(REF_FONT_SIZE * settings.captionSize * scale);
    const paddingX = Math.round(REF_PADDING_X * settings.captionSize * scale);
    const paddingY = Math.round(REF_PADDING_Y * settings.captionSize * scale);
    const cornerRadius = Math.round(REF_CORNER_RADIUS * settings.captionSize * scale);
    const marginBottom = outputSize.height * 0.02; // 2% from bottom of canvas
    const maxWidth = outputSize.width * (settings.width / 100); // Use width setting as percentage

    ctx.save();

    // Font Setup
    ctx.font = `600 ${fontSize}px Satoshi, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    ctx.textBaseline = 'middle';

    // Stack multiple captions vertically (though typically there's only one)
    // Start from the bottom - this is where the bottom of the first caption box will be
    let boxBottomY = outputSize.height - marginBottom;

    for (const caption of visibleCaptions) {
        const text = caption.text || '[empty]';
        const words = text.split(' ').filter(w => w.length > 0);

        // Calculate elapsed ratio within this segment (using cached output times)
        const segmentStart = caption.outputStartTimeMs;
        const segmentEnd = caption.outputEndTimeMs;
        const segmentDuration = segmentEnd - segmentStart;
        const elapsedRatio = segmentDuration > 0
            ? (currentTimeMs - segmentStart) / segmentDuration
            : 0;

        // Get which word should be highlighted (if highlighting is enabled)
        const highlightEnabled = settings.wordHighlight !== false;
        const highlightedWordIndex = highlightEnabled ? getHighlightedWordIndex(words, elapsedRatio) : -1;

        // Word wrap the text if it exceeds maxWidth - returns lines with word indices
        const wrappedLines = wrapTextWithWordInfo(ctx, words, maxWidth - (paddingX * 2));

        // Calculate box dimensions
        const lineHeight = fontSize * 1.4;
        const textHeight = wrappedLines.length * lineHeight;
        const boxHeight = textHeight + (paddingY * 2);

        // Measure the widest line for box width
        let maxLineWidth = 0;
        for (const lineInfo of wrappedLines) {
            const metrics = ctx.measureText(lineInfo.text);
            maxLineWidth = Math.max(maxLineWidth, metrics.width);
        }
        const boxWidth = maxLineWidth + (paddingX * 2);

        const centerX = outputSize.width / 2;
        const boxX = centerX - boxWidth / 2;
        // Calculate top of box from bottom position
        const boxY = boxBottomY - boxHeight;

        // Draw Background Box with backdrop blur effect
        ctx.fillStyle = hexToRgba(settings.backgroundColor, 1);
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

        // Draw Text with shadow - word by word with highlighting
        ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
        ctx.shadowBlur = 4;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 1;

        // Draw each line with per-word opacity
        const textColor = settings.textColor;
        let lineY = boxY + paddingY + lineHeight / 2;
        for (const lineInfo of wrappedLines) {
            drawLineWithHighlight(
                ctx,
                lineInfo,
                centerX,
                lineY,
                highlightedWordIndex,
                highlightEnabled,
                textColor
            );
            lineY += lineHeight;
        }

        // Move up for next caption (if any)
        boxBottomY = boxY - Math.round(16 * settings.captionSize);
    }

    ctx.restore();
}

/**
 * Calculates which word should be highlighted based on elapsed time in segment.
 * Uses letter count + base value for proportional timing.
 */
function getHighlightedWordIndex(words: string[], elapsedRatio: number): number {
    if (words.length === 0) return -1;
    if (words.length === 1) return 0;

    const WORD_BASE_VALUE = 3;
    const weights = words.map(word => word.length + WORD_BASE_VALUE);
    const totalWeight = weights.reduce((sum, w) => sum + w, 0);

    let cumulative = 0;
    for (let i = 0; i < words.length; i++) {
        cumulative += weights[i] / totalWeight;
        if (elapsedRatio < cumulative) return i;
    }
    return words.length - 1;
}

interface LineInfo {
    text: string;
    words: Array<{ word: string; globalIndex: number }>;
}

/**
 * Wraps text to fit within a maximum width, preserving word indices.
 * Returns an array of line info with word indices for highlighting.
 */
function wrapTextWithWordInfo(
    ctx: CanvasRenderingContext2D,
    words: string[],
    maxWidth: number
): LineInfo[] {
    const lines: LineInfo[] = [];
    let currentLineWords: Array<{ word: string; globalIndex: number }> = [];
    let currentLineText = '';

    for (let i = 0; i < words.length; i++) {
        const word = words[i];
        const testLine = currentLineText ? `${currentLineText} ${word}` : word;
        const metrics = ctx.measureText(testLine);

        if (metrics.width > maxWidth && currentLineText) {
            // Push current line and start new one
            lines.push({
                text: currentLineText,
                words: [...currentLineWords]
            });
            currentLineWords = [{ word, globalIndex: i }];
            currentLineText = word;
        } else {
            currentLineWords.push({ word, globalIndex: i });
            currentLineText = testLine;
        }
    }

    // Don't forget the last line
    if (currentLineText) {
        lines.push({
            text: currentLineText,
            words: currentLineWords
        });
    }

    return lines.length > 0 ? lines : [{ text: '', words: [] }];
}

/**
 * Draws a line of text with per-word highlighting.
 * When highlightEnabled is true, the highlighted word is drawn at full opacity, others at DIM_OPACITY.
 * When highlightEnabled is false, all words are drawn at full opacity.
 */
function drawLineWithHighlight(
    ctx: CanvasRenderingContext2D,
    lineInfo: LineInfo,
    centerX: number,
    y: number,
    highlightedWordIndex: number,
    highlightEnabled: boolean,
    textColor: string
) {
    const { words } = lineInfo;
    if (words.length === 0) return;

    // Measure total line width for centering
    const lineText = words.map(w => w.word).join(' ');
    const totalWidth = ctx.measureText(lineText).width;

    // Start drawing from left edge of centered text
    let currentX = centerX - totalWidth / 2;
    ctx.textAlign = 'left';

    for (let i = 0; i < words.length; i++) {
        const { word, globalIndex } = words[i];
        const isHighlighted = globalIndex === highlightedWordIndex;

        // Set opacity based on highlight state (all full opacity if highlighting disabled)
        const opacity = !highlightEnabled || isHighlighted ? 1 : DIM_OPACITY;
        ctx.fillStyle = hexToRgba(textColor, opacity);

        ctx.fillText(word, currentX, y);

        // Move to next word position (word width + space)
        const wordWidth = ctx.measureText(word).width;
        const spaceWidth = ctx.measureText(' ').width;
        currentX += wordWidth + spaceWidth;
    }

    // Reset text align for next operations
    ctx.textAlign = 'center';
}
