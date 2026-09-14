/**
 * Sample media for the Personal Settings preview
 * (plans/user-default-project-settings §3.5/§3.8).
 *
 * The defaults template project renders a still of a *sample* recording so
 * the user can see their defaults applied. The two images live on the CDN
 * (`cdn/samples/` in this repo is the folder mirrored there; files are
 * immutable — bump the `-vN` suffix instead of overwriting). In dev the
 * Vite server serves `cdn/samples/` at `/samples/` (see webapp/vite.config.ts)
 * so the placeholders work before they are uploaded.
 */
import { CDN_ORIGIN } from '@shared/types/bridge';

const SAMPLE_MEDIA_BASE = import.meta.env.DEV ? '/samples' : `${CDN_ORIGIN}/samples`;

export const SAMPLE_SCREEN_URL = `${SAMPLE_MEDIA_BASE}/defaults-preview-screen-v1.avif`;
export const SAMPLE_CAMERA_URL = `${SAMPLE_MEDIA_BASE}/defaults-preview-camera-v1.avif`;

/** Pixel size of the sample screen image (a 16:9 app UI without browser chrome). */
export const SAMPLE_SCREEN_SIZE = { width: 1920, height: 1080 } as const;
/** Pixel size of the sample camera image. */
export const SAMPLE_CAMERA_SIZE = { width: 1280, height: 720 } as const;

/**
 * The top-left card on the sample screen, in source pixels — the target of
 * the effect demos (spotlight rect; clicks land on its centre).
 */
export const SAMPLE_CARD_RECT = { x: 320, y: 130, width: 480, height: 280 } as const;
/** Corner radius of that card, in source pixels. */
export const SAMPLE_CARD_RADIUS_PX = 16;

/** Where the effect demos click, in sample-screen source pixels — the centre of the card. */
export const SAMPLE_CLICK_POINT = {
    x: SAMPLE_CARD_RECT.x + SAMPLE_CARD_RECT.width / 2,
    y: SAMPLE_CARD_RECT.y + SAMPLE_CARD_RECT.height / 2,
} as const;

/**
 * Sentinel storage paths for the template's sources. They never hit
 * storage: the preview maps them straight to the loaded sample images.
 */
export const SAMPLE_SCREEN_PATH = 'sample/defaults-preview-screen';
export const SAMPLE_CAMERA_PATH = 'sample/defaults-preview-camera';
export const SAMPLE_MIC_PATH = 'sample/defaults-preview-mic';
