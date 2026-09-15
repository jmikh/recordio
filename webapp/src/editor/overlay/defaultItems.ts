/**
 * Default overlay item factory, shared by the video editor (items sized
 * to the output frame) and the screenshot editor (items sized to the
 * visible/cropped area — plans/screenshots).
 */
import type { Rect, Size } from '@shared/types';
import type { OverlayItem, OverlayItemType } from '@shared/types/overlay';
import type { OverlaySettings } from '@shared/types/settings';
import type { AnnotationDefaults } from '@shared/types/screenshot';

// Hardcoded fallbacks for projects without saved defaults
const BLUR_FALLBACK = { blurRadiusPx: 20 };
const TEXT_FALLBACK = { color: '#454545', backgroundColor: '#ffdb5700', fontSizePx: 0 };
const ARROW_FALLBACK = { color: '#7B61FF', strokeWidthPx: 4 };
const BORDER_FALLBACK = { color: '#7B61FF', borderWidthPx: 4 };

/**
 * A new item of `type` placed inside `area` (its centre / proportional
 * positions), taking colours and sizes from `defaults`. Coordinates are
 * in the same space as `area`.
 */
export const createDefaultItemInRect = (type: OverlayItemType, area: Rect, defaults: AnnotationDefaults): OverlayItem => {
    const id = crypto.randomUUID();
    const { x: X, y: Y, width: W, height: H } = area;

    switch (type) {
        case 'blur': {
            const d = defaults.blurDefaults ?? BLUR_FALLBACK;
            const w = Math.round(W * 0.15);
            const h = Math.round(H * 0.12);
            return {
                id, type: 'blur',
                rectPx: { x: X + Math.round((W - w) / 2), y: Y + Math.round((H - h) / 2), width: w, height: h },
                blurRadiusPx: d.blurRadiusPx,
                borderRadiusPx: [0, 0, 0, 0],
            };
        }
        case 'text': {
            const d = defaults.textDefaults ?? TEXT_FALLBACK;
            const fontSize = d.fontSizePx > 0 ? d.fontSizePx : Math.round(Math.min(W, H) * 0.025);
            return {
                id, type: 'text', text: 'Text',
                topLeft: { x: X + Math.round(W * 0.3), y: Y + Math.round(H * 0.45) },
                widthPx: Math.round(W * 0.2),
                fontSizePx: fontSize, fontFamily: 'Inter', fontWeight: 400,
                color: d.color, backgroundColor: d.backgroundColor,
            };
        }
        case 'arrow': {
            const d = defaults.arrowDefaults ?? ARROW_FALLBACK;
            return {
                id, type: 'arrow',
                tail: { x: X + Math.round(W * 0.3), y: Y + Math.round(H * 0.6) },
                head: { x: X + Math.round(W * 0.6), y: Y + Math.round(H * 0.4) },
                color: d.color, strokeWidthPx: d.strokeWidthPx,
                effect: 'none',
            };
        }
        case 'border': {
            const bw = Math.round(W * 0.15);
            const bh = Math.round(H * 0.125);
            const d = defaults.borderDefaults ?? BORDER_FALLBACK;
            return {
                id, type: 'border',
                rectPx: { x: X + Math.round((W - bw) / 2), y: Y + Math.round((H - bh) / 2), width: bw, height: bh },
                color: d.color, borderWidthPx: d.borderWidthPx, borderRadiusPx: [8, 8, 8, 8],
                effect: 'none',
            };
        }
    }
};

/** Video editor form: a new item centred in the output frame. */
export const createDefaultItem = (type: OverlayItemType, outputSize: Size, overlaySettings: OverlaySettings): OverlayItem =>
    createDefaultItemInRect(type, { x: 0, y: 0, width: outputSize.width, height: outputSize.height }, overlaySettings);
