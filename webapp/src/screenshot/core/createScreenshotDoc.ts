/**
 * ScreenshotDoc factory (plans/screenshots). The document is a plain
 * struct: source metadata, an optional crop, the annotation list, the
 * per-type defaults new annotations start from, the background frame and
 * the optional spotlight.
 */
import type { AnnotationDefaults, RawScreenshot, ScreenshotBackground, ScreenshotDoc, ScreenshotSource } from '@shared/types';

export const SCREENSHOT_SCHEMA_VERSION = 2;

/** Longest side Chrome/Safari canvases handle comfortably; taller captures are downscaled on import. */
export const MAX_SOURCE_SIDE_PX = 16384;

export const DEFAULT_ANNOTATION_DEFAULTS: AnnotationDefaults = {
    blurDefaults: { blurRadiusPx: 20 },
    textDefaults: { color: '#454545', backgroundColor: '#ffdb5700', fontSizePx: 0 },
    arrowDefaults: { color: '#7B61FF', strokeWidthPx: 4 },
    borderDefaults: { color: '#7B61FF', borderWidthPx: 4 },
};

/** Off until switched on; the colours match the video editor's default background. */
export const DEFAULT_BACKGROUND: ScreenshotBackground = {
    enabled: false,
    colorMode: 'gradient',
    color: '#6078c4ff',
    gradientColors: ['#60bfffff', '#2e39ffff'],
    gradientDirection: 135,
    padding: 0.06,
    borderRadiusPx: 20,
};

/** New spotlights start at the video editor's defaults. */
export const DEFAULT_SPOTLIGHT_DIM_OPACITY = 0.5;
export const DEFAULT_SPOTLIGHT_FEATHER_PX = 60;

export function createScreenshotDoc(id: string, source: ScreenshotSource): ScreenshotDoc {
    return {
        id,
        schemaVersion: SCREENSHOT_SCHEMA_VERSION,
        source,
        cropPx: null,
        annotations: [],
        annotationDefaults: { ...DEFAULT_ANNOTATION_DEFAULTS },
        background: { ...DEFAULT_BACKGROUND },
        spotlight: null,
    };
}

/** Source block from the extension's capture metadata (storagePath is stamped by the server). */
export function sourceFromRaw(raw: RawScreenshot, size: { width: number; height: number }): ScreenshotSource {
    return {
        storagePath: '',
        widthPx: size.width,
        heightPx: size.height,
        devicePixelRatio: raw.page.devicePixelRatio,
        pageUrl: raw.page.url || undefined,
        pageTitle: raw.page.title || undefined,
        captureMode: raw.captureMode,
    };
}

/**
 * Downscales a PNG whose longest side exceeds MAX_SOURCE_SIDE_PX so the
 * editor canvas, export and thumbnail never hit browser canvas limits.
 * Returns the input untouched when it already fits.
 */
export async function fitSourceImage(blob: Blob, size: { width: number; height: number }): Promise<{ blob: Blob; size: { width: number; height: number } }> {
    const longest = Math.max(size.width, size.height);
    if (longest <= MAX_SOURCE_SIDE_PX) return { blob, size };

    const scale = MAX_SOURCE_SIDE_PX / longest;
    const width = Math.max(1, Math.round(size.width * scale));
    const height = Math.max(1, Math.round(size.height * scale));
    const bitmap = await createImageBitmap(blob);
    try {
        const canvas = new OffscreenCanvas(width, height);
        const ctx = canvas.getContext('2d');
        if (!ctx) return { blob, size };
        ctx.drawImage(bitmap, 0, 0, width, height);
        const out = await canvas.convertToBlob({ type: 'image/png' });
        return { blob: out, size: { width, height } };
    } finally {
        bitmap.close();
    }
}

/** Pixel size of an image blob. */
export async function readImageSize(blob: Blob): Promise<{ width: number; height: number }> {
    const bitmap = await createImageBitmap(blob);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
}
