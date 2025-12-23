
import type { KeyboardEvent, Size } from '../../core/types';

/**
 * Draws keysrokes at the top of the canvas.
 *
 * @param ctx 2D Canvas Context
 * @param events List of keystroke events
 * @param sourceTimeMs Current Source Time
 * @param outputSize Size of the output canvas
 */
export function drawKeyboardOverlay(
    ctx: CanvasRenderingContext2D,
    events: KeyboardEvent[],
    sourceTimeMs: number,
    outputSize: Size
) {
    const EVENT_DURATION = 1500; // Show for 1.5 seconds
    const FADE_OUT_START = 1000;

    // Filter relevant events
    // We only care about events that are "active"
    const activeEvents = events.filter(e =>
        sourceTimeMs >= e.timestamp && sourceTimeMs <= e.timestamp + EVENT_DURATION
    );

    if (activeEvents.length === 0) return;

    // Sort active events by timestamp
    activeEvents.sort((a, b) => a.timestamp - b.timestamp);

    // Only show the latest active event to avoid clutter
    // (Or we could stack them?)
    const latestEvent = activeEvents[activeEvents.length - 1];

    // Calculate Opacity
    const elapsed = sourceTimeMs - latestEvent.timestamp;
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

    // Drawing Settings
    const fontSize = 64;
    const paddingX = 40;
    const paddingY = 20;
    const cornerRadius = 16;
    const marginTop = 80;

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

    const x = outputSize.width / 2;
    const y = marginTop;

    // Draw Background Box
    ctx.fillStyle = `rgba(30, 30, 30, ${0.85 * opacity})`;
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.1 * opacity})`;
    ctx.lineWidth = 2;

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
    ctx.fillText(text, x, boxY + boxHeight / 2 + 4); // +4 for visual centering correction

    ctx.restore();
}
