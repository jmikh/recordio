/**
 * Toolbar Painter
 * 
 * Draws a minimal, branded browser toolbar overlay for window recordings
 * when toolbar is enabled. Renders: traffic lights, address bar with URL,
 * Recordio icon, puzzle icon, and three-dot menu.
 * 
 * ## Scaling Strategy
 * All toolbar elements (traffic lights, icons, dots, fonts, vertical positions)
 * scale based on toolbar HEIGHT (rect.height / REF_TOOLBAR_HEIGHT) to prevent
 * distortion and keep circles circular. Only the address bar WIDTH stretches
 * horizontally to fill available space.
 */

import type { UrlChangeEvent, Rect } from '../types';
import type { ToolbarSettings } from '../types/settings';
import type { RenderContext } from '../utils/renderContext';
import logoUrl from '@shared/assets/logo.svg';
import puzzleUrl from '@shared/assets/puzzle_icon.svg';
import { roundRectPath } from './utils/roundRect';

// ══════════════════════════════════════════
// Reference Constants (designed for 60px height)
// ══════════════════════════════════════════

const REF_TOOLBAR_HEIGHT = 60;

// Layout
const REF_PADDING_X = 18;
const REF_TRAFFIC_GAP = 10;

// Traffic lights
const REF_TL_RADIUS = 10;

// Address bar
const REF_ADDR_BAR_HEIGHT = 36;
const REF_ADDR_BAR_LOCK_SIZE = 16;
const REF_ADDR_BAR_FONT_SIZE = 18;
const REF_ADDR_BAR_LOCK_PAD = 12; // padding before lock icon inside address bar
const REF_ADDR_BAR_TEXT_PAD = 5;  // gap between lock and text

// Right-side icons
const REF_ICON_SIZE = 22;
const REF_ICON_GAP = 32;        // gap between icon centers
const REF_RIGHT_ICONS_ZONE = 100; // total width reserved for right icons

// Three-dot menu
const REF_DOT_RADIUS = 2.5;
const REF_DOT_GAP = 6;

// Misc
const REF_SEPARATOR_HEIGHT = 1;
const REF_SECTION_GAP = 10;     // gap between traffic lights and address bar

// ══════════════════════════════════════════
// Module-level cached images
// ══════════════════════════════════════════

let logoImg: CanvasImageSource | null = null;
let logoLoading = false;
function getLogoImage(renderCtx: RenderContext): CanvasImageSource | null {
    if (logoImg) return logoImg;
    if (!logoLoading) {
        logoLoading = true;
        renderCtx.loadImage(logoUrl).then(img => { logoImg = img; });
    }
    return null;
}

let puzzleImg: CanvasImageSource | null = null;
let puzzleLoading = false;
function getPuzzleImage(renderCtx: RenderContext): CanvasImageSource | null {
    if (puzzleImg) return puzzleImg;
    if (!puzzleLoading) {
        puzzleLoading = true;
        renderCtx.loadImage(puzzleUrl).then(img => { puzzleImg = img; });
    }
    return null;
}

// ══════════════════════════════════════════
// Color Schemes
// ══════════════════════════════════════════

const LIGHT_COLORS = {
    toolbarBg: '#DEE1E6',
    addressBarBg: '#F1F3F4',
    textColor: '#5F6368',
    addressTextColor: '#202124',
    separatorColor: '#C4C7CC',
};

const DARK_COLORS = {
    toolbarBg: '#35363A',
    addressBarBg: '#202124',
    textColor: '#9AA0A6',
    addressTextColor: '#E8EAED',
    separatorColor: '#4A4B4F',
};

/** Traffic light colors (same for both themes) */
const TL_RED = '#FF5F57';
const TL_YELLOW = '#FEBC2E';
const TL_GREEN = '#28C840';

// ══════════════════════════════════════════
// URL Lookup
// ══════════════════════════════════════════

/**
 * Finds the active URL at the given source time.
 * Returns the hostname or full URL based on urlMode, or fallback text.
 */
export function getUrlAtTime(
    urlChanges: UrlChangeEvent[],
    sourceTimeMs: number,
    fallbackName: string,
    urlMode: 'full' | 'short' = 'short'
): string {
    for (let i = urlChanges.length - 1; i >= 0; i--) {
        if (urlChanges[i].timestamp <= sourceTimeMs && urlChanges[i].url) {
            return formatUrl(urlChanges[i].url, urlMode, fallbackName);
        }
    }
    const first = urlChanges.find(e => e.url);
    if (first) {
        return formatUrl(first.url, urlMode, fallbackName);
    }
    return fallbackName;
}

function formatUrl(url: string, urlMode: 'full' | 'short', fallback: string): string {
    if (urlMode === 'full') return url;
    try {
        return new URL(url).hostname;
    } catch {
        return url || fallback;
    }
}

// ══════════════════════════════════════════
// Toolbar Drawing
// ══════════════════════════════════════════

/**
 * Draws the custom minimal toolbar.
 * 
 * All dimensions scale based on toolbar height to prevent distortion.
 * Traffic lights, icons, and dots remain circular. Address bar width fills available space.
 *
 * @param ctx          Canvas rendering context (already positioned/clipped by caller)
 * @param rect         Toolbar strip bounds in output pixels
 * @param addressText  Text to display in the address bar
 * @param settings     Toolbar settings (theme, urlMode — no dimension fields)
 */
export function drawToolbar(
    ctx: CanvasRenderingContext2D,
    rect: Rect,
    addressText: string,
    settings: ToolbarSettings,
    renderCtx?: RenderContext
): void {
    const { x, y, width, height } = rect;
    const s = height / REF_TOOLBAR_HEIGHT; // Height-based scale for all elements

    const colors = settings.theme === 'dark' ? DARK_COLORS : LIGHT_COLORS;

    // ── Background ──
    ctx.fillStyle = colors.toolbarBg;
    ctx.fillRect(x, y, width, height);

    // ── Separator line at bottom ──
    ctx.fillStyle = colors.separatorColor;
    ctx.fillRect(x, y + height - REF_SEPARATOR_HEIGHT * s, width, REF_SEPARATOR_HEIGHT * s);

    const cy = y + height / 2; // Vertical center
    let cx = x; // Running X cursor

    // ── Traffic Lights ──
    const tlRadius = REF_TL_RADIUS * s;
    const tlGap = REF_TRAFFIC_GAP * s;
    const tlLeftPad = REF_PADDING_X * s;
    cx += tlLeftPad + tlRadius;

    const trafficColors = [TL_RED, TL_YELLOW, TL_GREEN];
    for (const color of trafficColors) {
        ctx.beginPath();
        ctx.arc(cx, cy, tlRadius, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        cx += tlRadius * 2 + tlGap;
    }

    cx += REF_SECTION_GAP * s;

    // ── Address Bar ──
    const addrBarHeight = REF_ADDR_BAR_HEIGHT * s;
    const addrBarY = cy - addrBarHeight / 2;
    const rightPad = REF_PADDING_X * s;
    const rightIconsWidth = REF_RIGHT_ICONS_ZONE * s;
    const addrBarWidth = width - (cx - x) - rightPad - rightIconsWidth;

    if (addrBarWidth > 20 * s) {
        const addrBarRadius = addrBarHeight / 2;

        roundRectPath(ctx, cx, addrBarY, addrBarWidth, addrBarHeight, addrBarRadius);
        ctx.fillStyle = colors.addressBarBg;
        ctx.fill();

        // Slider icon (two horizontal sliders, top thumb-left, bottom thumb-right)
        const sliderX = cx + REF_ADDR_BAR_LOCK_PAD * s;
        const sliderSize = REF_ADDR_BAR_LOCK_SIZE * s;
        const sliderW = sliderSize * 0.75;
        const trackH = 2 * s;
        const thumbR = 2 * s;
        const sliderSpacing = sliderSize * 0.35; // vertical gap between the two sliders

        // Circular background behind icon (toolbar color, not address bar)
        const iconCenterX = sliderX + sliderW / 2;
        const iconBgRadius = sliderSize * 0.7;
        ctx.beginPath();
        ctx.arc(iconCenterX, cy, iconBgRadius, 0, Math.PI * 2);
        ctx.fillStyle = colors.toolbarBg;
        ctx.fill();

        ctx.lineCap = 'round';

        // Top slider — thumb to the left
        const topY = cy - sliderSpacing / 2;
        ctx.fillStyle = colors.textColor;
        ctx.fillRect(sliderX, topY - trackH / 2, sliderW, trackH);
        ctx.beginPath();
        ctx.arc(sliderX + sliderW * 0.3, topY, thumbR, 0, Math.PI * 2);
        ctx.fillStyle = colors.toolbarBg;
        ctx.fill();
        ctx.strokeStyle = colors.textColor;
        ctx.lineWidth = 1.5 * s;
        ctx.stroke();

        // Bottom slider — thumb to the right
        const botY = cy + sliderSpacing / 2;
        ctx.fillStyle = colors.textColor;
        ctx.fillRect(sliderX, botY - trackH / 2, sliderW, trackH);
        ctx.beginPath();
        ctx.arc(sliderX + sliderW * 0.7, botY, thumbR, 0, Math.PI * 2);
        ctx.fillStyle = colors.toolbarBg;
        ctx.fill();
        ctx.strokeStyle = colors.textColor;
        ctx.lineWidth = 1.5 * s;
        ctx.stroke();

        // Address text
        const textX = sliderX + sliderSize + REF_ADDR_BAR_TEXT_PAD * s;
        const maxTextWidth = addrBarWidth - (textX - cx) - 10 * s;

        ctx.font = `${REF_ADDR_BAR_FONT_SIZE * s}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
        ctx.fillStyle = colors.addressTextColor;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';

        // Clip long text with ellipsis
        let displayText = addressText;
        const measured = ctx.measureText(displayText);
        if (measured.width > maxTextWidth) {
            while (ctx.measureText(displayText + '…').width > maxTextWidth && displayText.length > 1) {
                displayText = displayText.slice(0, -1);
            }
            displayText += '…';
        }

        ctx.fillText(displayText, textX, cy);
    }

    // ── Right-side Icons ──
    const rightX = x + width - rightPad;

    // Three-dot menu ⋮
    const dotRadius = REF_DOT_RADIUS * s;
    const dotGap = REF_DOT_GAP * s;
    const dotsX = rightX - dotRadius;
    ctx.fillStyle = colors.textColor;
    for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.arc(dotsX, cy + i * dotGap, dotRadius, 0, Math.PI * 2);
        ctx.fill();
    }

    // Puzzle icon (extensions)
    const iconSize = REF_ICON_SIZE * s;
    const puzzleX = dotsX - REF_ICON_GAP * s;
    const puzzle = renderCtx ? getPuzzleImage(renderCtx) : null;
    if (puzzle) {
        ctx.drawImage(puzzle, puzzleX - iconSize / 2, cy - iconSize / 2, iconSize, iconSize);
    }

    // Recordio icon (branded logo)
    const ricoX = puzzleX - REF_ICON_GAP * s;
    const logo = renderCtx ? getLogoImage(renderCtx) : null;
    if (logo) {
        ctx.drawImage(logo, ricoX - iconSize / 2, cy - iconSize / 2, iconSize, iconSize);
    }
}
