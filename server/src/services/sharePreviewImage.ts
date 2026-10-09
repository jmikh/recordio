/**
 * Link-preview card images for shared videos
 * (plans/share-link-previews-oneshot.md, design "B · Thumbnail + play
 * overlay"). Pure buffer-in → PNG-out, so tests run the real renderer.
 *
 * Text is drawn as SVG PATHS from a bundled font (assets/fonts, OFL) via
 * opentype.js — never as <text> or sharp's Pango `text` input. Both of
 * those go through the platform's font stack: on macOS sharp ignores
 * `fontfile` entirely and falls back to Helvetica, and Railway's image
 * can't be relied on to have fontconfig set up. Paths render identically
 * everywhere.
 *
 * Every size below is the 400×225 mock ×3.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
// Default import: Node resolves the package's UMD `main`, whose functions
// aren't detectable as named ESM exports
import opentype, { type Font } from 'opentype.js';
import { formatDuration } from '@shared/utils/formatDuration';

export const PREVIEW_WIDTH = 1200;
export const PREVIEW_HEIGHT = 675;

const BRAND = '#4B36B8';
const PURPLE = '#7D5EE0';
const CREAM = '#F8F6EB';
const FONT_RELATIVE_PATH = join('assets', 'fonts', 'Manrope-ExtraBold.ttf');

/** Logo mark paths from shared/assets/logo.svg (628×628 viewBox, y-flipped) */
const LOGO_PATHS = [
    'M130.1325 536 205.0049 461.8536H156.5268C153.8046 461.8639 151.0693 461.6751 148.3698 461.3226 119.8525 457.5993 97.08818 435.6359 92.66317 407.223 92.2433 404.5269 92.04774 401.8528 92 399.1246V239.6137H218.0031C220.0154 239.665 222.0323 240.004 223.9716 240.543 231.5277 242.643 237.6641 248.0974 240.0868 255.4785 240.6015 257.0476 240.9533 258.6775 241.0815 260.3242V388.3711H365.1614C368.0465 388.4573 370.9029 389.0265 373.5837 390.0969 379.863 392.6044 384.7985 397.4691 387.3777 403.5721 388.2811 405.7098 388.9062 407.9703 389.1683 410.2764V536H130.1325Z',
    'M497.8675 92 422.9951 166.1464H471.4732C474.1954 166.1361 476.9307 166.325 479.6302 166.6774 508.1475 170.4007 530.9118 192.3641 535.3368 220.777 535.7567 223.4731 535.9523 226.1472 536 228.8754V388.3863H409.9969C407.9846 388.335 405.9677 387.996 404.0284 387.457 396.4723 385.357 390.3359 379.9026 387.9132 372.5215 387.3985 370.9524 387.0467 369.3225 386.9185 367.6758V239.6289H262.8386C259.9535 239.5427 257.0971 238.9735 254.4163 237.9031 248.137 235.3956 243.2015 230.5309 240.6223 224.4279 239.7189 222.2902 239.0938 220.0297 238.8317 217.7236V92H497.8675Z',
];

/** The logo mark as a nested <svg>, squircle in `plate`, brackets in `mark` */
function logoSvg(x: number, y: number, size: number, plate: string, mark: string): string {
    const paths = LOGO_PATHS
        .map((d) => `<path transform="matrix(1,0,0,-1,0,628)" d="${d}" fill="${mark}"/>`)
        .join('');
    return `<svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="0 0 628 628">`
        + `<rect width="628" height="628" rx="150" fill="${plate}"/>${paths}</svg>`;
}

/**
 * tsup bundles src/ into dist/server.js but doesn't copy assets, so the
 * font sits at a different depth in dev (src/services/) and prod (dist/):
 * walk up to the directory that has it.
 */
function resolveFontFile(): string {
    let dir = dirname(fileURLToPath(import.meta.url));
    for (let i = 0; i < 5; i++) {
        const candidate = join(dir, FONT_RELATIVE_PATH);
        if (existsSync(candidate)) return candidate;
        dir = dirname(dir);
    }
    throw new Error(`sharePreviewImage: ${FONT_RELATIVE_PATH} not found above ${fileURLToPath(import.meta.url)}`);
}

let font: Font | undefined;
function loadFont(): Font {
    if (!font) {
        const file = readFileSync(resolveFontFile());
        font = opentype.parse(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength));
    }
    return font;
}

/**
 * `text` as one SVG path starting at `left`, its INK centred on
 * `centreY` (so caps and digits sit optically centred in a pill).
 * Only ever called with our own strings — never user content.
 */
function textSvg(text: string, sizePx: number, left: number, centreY: number, color: string): string {
    const f = loadFont();
    const ink = f.getPath(text, 0, 0, sizePx).getBoundingBox();
    const baseline = centreY - (ink.y1 + ink.y2) / 2;
    // A number argument means flipY: false — getPath is already y-down
    return `<path d="${f.getPath(text, left, baseline, sizePx).toPathData(2)}" fill="${color}"/>`;
}

function textWidth(text: string, sizePx: number): number {
    return loadFont().getAdvanceWidth(text, sizePx);
}

function svgLayer(body: string): Buffer {
    return Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${PREVIEW_WIDTH}" height="${PREVIEW_HEIGHT}">${body}</svg>`,
    );
}

/**
 * The design-B card: the project thumbnail letterboxed onto brand purple
 * (16:9 recordings fill it), a dark tint, a centred play button, a
 * "Recordio" chip top-left and — when known — a duration pill
 * bottom-right.
 */
export async function renderVideoPreviewCard(opts: {
    thumbnail: Uint8Array;
    durationMs?: number;
}): Promise<Buffer> {
    const base = await sharp(opts.thumbnail)
        .resize(PREVIEW_WIDTH, PREVIEW_HEIGHT, { fit: 'contain', background: BRAND })
        .toBuffer();

    // Chip: 30px inset, 72px tall, 48px logo, 36px wordmark
    const chipX = 30;
    const chipY = 30;
    const chipH = 72;
    const logoSize = 48;
    const wordmarkX = chipX + 15 + logoSize + 18;
    const chipW = wordmarkX - chipX + textWidth('Recordio', 36) + 30;

    // Play button: 192px disc with a 9px white ring; the triangle sits
    // 6px right of centre so it reads optically centred
    const cx = PREVIEW_WIDTH / 2;
    const cy = PREVIEW_HEIGHT / 2;
    const triangle = `M${cx - 21} ${cy - 28.5} L${cx + 33} ${cy} L${cx - 21} ${cy + 28.5} Z`;

    // Duration pill: 30px inset bottom-right, 66px tall, 24px side padding
    let pill = '';
    if (opts.durationMs !== undefined) {
        const label = formatDuration(opts.durationMs);
        const w = textWidth(label, 36) + 48;
        const h = 66;
        const x = PREVIEW_WIDTH - 30 - w;
        const y = PREVIEW_HEIGHT - 30 - h;
        pill = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="18" fill="rgba(20,16,35,0.82)"/>`
            + textSvg(label, 36, x + 24, y + h / 2, '#FFFFFF');
    }

    const overlay = svgLayer(
        `<rect width="${PREVIEW_WIDTH}" height="${PREVIEW_HEIGHT}" fill="rgba(20,12,40,0.22)"/>`
        + `<circle cx="${cx}" cy="${cy}" r="${96 - 4.5}" fill="${PURPLE}" stroke="#FFFFFF" stroke-width="9"/>`
        + `<path d="${triangle}" fill="#FFFFFF" stroke="#FFFFFF" stroke-width="6" stroke-linejoin="round"/>`
        + `<rect x="${chipX}" y="${chipY}" width="${chipW}" height="${chipH}" rx="${chipH / 2}" fill="rgba(20,16,35,0.78)"/>`
        + logoSvg(chipX + 15, chipY + (chipH - logoSize) / 2, logoSize, PURPLE, CREAM)
        + textSvg('Recordio', 36, wordmarkX, chipY + chipH / 2, CREAM)
        + pill,
    );

    return sharp(base).composite([{ input: overlay, left: 0, top: 0 }]).png().toBuffer();
}

/**
 * The card for anything that isn't a public video with a thumbnail:
 * brand purple, centred logo + wordmark. Identical for every slug (so
 * it reveals nothing) — rendered once per process.
 */
let genericCard: Promise<Buffer> | undefined;
export function renderGenericPreviewCard(): Promise<Buffer> {
    if (!genericCard) {
        const logoSize = 156;
        const gap = 42;
        const x = (PREVIEW_WIDTH - (logoSize + gap + textWidth('Recordio', 90))) / 2;
        const svg = svgLayer(
            `<rect width="${PREVIEW_WIDTH}" height="${PREVIEW_HEIGHT}" fill="${BRAND}"/>`
            + logoSvg(x, (PREVIEW_HEIGHT - logoSize) / 2, logoSize, CREAM, BRAND)
            + textSvg('Recordio', 90, x + logoSize + gap, PREVIEW_HEIGHT / 2, CREAM),
        );
        const rendering = sharp(svg).png().toBuffer();
        // A failed render must not be cached for the life of the process
        rendering.catch(() => { genericCard = undefined; });
        genericCard = rendering;
    }
    return genericCard;
}
