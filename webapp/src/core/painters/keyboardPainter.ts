
import type { KeyboardEvent, Size } from '../../types';
import type { KeyboardSettings } from '../../types/settings';
import type { TimeMapper } from '../mappers/timeMapper';

// ══════════════════════════════════════════
// Reference Constants (designed for 1080px height)
// ══════════════════════════════════════════

const REF_OUTPUT_HEIGHT = 1080;
const REF_FONT_SIZE = 128;
const REF_PADDING_X = 40;
const REF_PADDING_Y = 20;
const REF_CORNER_RADIUS = 16;

/**
 * Draws keystrokes at the top or bottom of the canvas.
 *
 * @param ctx 2D Canvas Context
 * @param events List of keystroke events
 * @param currentOutputTime Current Output Time
 * @param outputSize Size of the output canvas
 * @param timeMapper Maps source time to output time
 * @param settings Keyboard settings (includes multipliers)
 */
export function drawKeyboardOverlay(
    ctx: CanvasRenderingContext2D,
    events: KeyboardEvent[],
    currentOutputTime: number,
    outputSize: Size,
    timeMapper: TimeMapper,
    settings: KeyboardSettings
) {
    const EVENT_DURATION = 1500; // Show for 1.5 seconds
    const FADE_OUT_START = 1000;

    // Filter relevant events — map source timestamps to output time, skip hidden
    const activeEvents: { event: KeyboardEvent; mappedTime: number }[] = [];
    for (const e of events) {
        const mappedTime = timeMapper.mapSourceToOutputTime(e.timestamp);
        if (mappedTime < 0) continue; // Event is in a cut/hidden segment
        if (currentOutputTime >= mappedTime && currentOutputTime <= mappedTime + EVENT_DURATION) {
            activeEvents.push({ event: e, mappedTime });
        }
    }

    if (activeEvents.length === 0) return;

    // Sort active events by mapped output time
    activeEvents.sort((a, b) => a.mappedTime - b.mappedTime);

    // Only show the latest active event to avoid clutter
    const latest = activeEvents[activeEvents.length - 1];
    const latestEvent = latest.event;

    // Calculate Opacity
    const elapsed = currentOutputTime - latest.mappedTime;
    let opacity = 1;
    if (elapsed > FADE_OUT_START) {
        opacity = 1 - ((elapsed - FADE_OUT_START) / (EVENT_DURATION - FADE_OUT_START));
    }
    // Clamp opacity
    opacity = Math.max(0, Math.min(1, opacity));


    // Construct the Label
    const parts: string[] = [];

    // Mac Symbols: ⌘ (Meta), ⌃ (Ctrl), ⌥ (Alt), ⇧ (Shift)
    if (latestEvent.metaKey) parts.push('⌘');
    if (latestEvent.ctrlKey) parts.push('⌃');
    if (latestEvent.altKey) parts.push('⌥');
    if (latestEvent.shiftKey) parts.push('⇧');

    // Key Name
    let label = latestEvent.key.toUpperCase();

    // Formatting common special keys
    const specialKeys: Record<string, string> = {
        ' ': 'SPACE',
        'ENTER': '⏎',
        'BACKSPACE': '⌫',
        'DELETE': 'DEL',
        'ARROWUP': '↑',
        'ARROWDOWN': '↓',
        'ARROWLEFT': '←',
        'ARROWRIGHT': '→',
        'ESCAPE': 'ESC',
        'TAB': '⇥'
    };

    if (specialKeys[label] || specialKeys[latestEvent.code?.toUpperCase()]) {
        label = specialKeys[label] || specialKeys[latestEvent.code?.toUpperCase()];
    }

    parts.push(label);
    const text = parts.join(' ');

    // Drawing Settings — scale by output height and hotkeysSize multiplier
    const scale = outputSize.height / REF_OUTPUT_HEIGHT;
    const fontSize = Math.round(REF_FONT_SIZE * settings.hotkeysSize * scale);
    const paddingX = Math.round(REF_PADDING_X * settings.hotkeysSize * scale);
    const paddingY = Math.round(REF_PADDING_Y * settings.hotkeysSize * scale);
    const cornerRadius = Math.round(REF_CORNER_RADIUS * settings.hotkeysSize * scale);

    ctx.save();

    // Font Setup
    ctx.font = `bold ${fontSize}px Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';

    // Measure Text
    const metrics = ctx.measureText(text);
    // const textHeight = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent; // Approximate
    const boxWidth = metrics.width + (paddingX * 2);
    const boxHeight = fontSize + (paddingY * 2);

    const margin = outputSize.height * (settings.hotkeysMargin / 100);
    const x = outputSize.width / 2;
    const y = settings.hotkeysPlacement === 'bottom'
        ? outputSize.height - margin - boxHeight
        : margin;

    // Draw Background Box
    ctx.fillStyle = `rgba(30, 30, 30, ${0.85 * opacity})`;
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.1 * opacity})`;
    ctx.lineWidth = 2 * scale;

    const boxX = x - boxWidth / 2;
    const boxY = y;

    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(boxX, boxY, boxWidth, boxHeight, cornerRadius);
    } else {
        ctx.rect(boxX, boxY, boxWidth, boxHeight);
    }
    ctx.fill();
    ctx.stroke();

    // Draw Text
    ctx.fillStyle = `rgba(255, 255, 255, ${opacity})`;
    ctx.fillText(text, x, boxY + boxHeight / 2 + 4 * scale); // +4 for visual centering correction

    ctx.restore();
}
