/**
 * Screenshot Types
 *
 * Screenshots are a separate sub-product from video projects
 * (plans/screenshots/screenshots-tiered-plan.md): captured by the
 * extension (visible area / full page / region), annotated in the
 * webapp, stored in the `screenshots` table.
 *
 * Two shapes live here:
 *   - RawScreenshot  — the extension's capture result (IndexedDB + bridge handoff)
 *   - ScreenshotDoc  — the editor document persisted in screenshots.screenshot_data
 */

import type { ID, Point, Rect, Size, RawRecording } from './core';
import type { OverlayItem } from './overlay';

export type ScreenshotCaptureMode = 'visible' | 'fullPage' | 'region';

// ==========================================
// RAW SCREENSHOT (extension → webapp handoff)
// ==========================================

/**
 * Lightweight capture data for handoff between extension and website.
 * `kind` discriminates it from RawRecording (which has no `kind`) in the
 * extension's IndexedDB store and in the bridge metadata response.
 */
export interface RawScreenshot {
    kind: 'screenshot';
    id: string;
    /** Page title (or hostname) — the initial screenshot name */
    name: string;
    /** Capture timestamp (ms since epoch) */
    timestamp: number;
    captureMode: ScreenshotCaptureMode;
    image: {
        /** Extension: recordio-blob://shot-<id>-image (overwritten on cloud import) */
        storagePath: string;
        mimeType: 'image/png';
        /** Image size in device pixels */
        size: Size;
    };
    page: {
        url: string;
        title: string;
        /** Viewport size in CSS pixels at capture time */
        viewport: Size;
        devicePixelRatio: number;
        /** Actual device px per CSS px in the captured bitmap (bitmap.width / viewport.width) */
        scale: number;
    };
    /** Region mode only — the selected rect in CSS px, viewport-relative */
    region?: Rect;
    /** Full-page mode only */
    fullPage?: {
        /** Document scroll size in CSS px */
        documentSize: Size;
        tileCount: number;
        /** Capture stopped at the tile cap before reaching the bottom */
        truncated: boolean;
        /** Output was uniformly downscaled to fit canvas limits */
        downscaled: boolean;
        /** Inner scrollers tiled as their own strips */
        stripCount?: number;
        /** Fixed header band (CSS px) clipped out of tiles after the first */
        headerHeight?: number;
        /** The page height changed after the first scrolls and the plan was adjusted */
        replanned?: boolean;
    };
}

export type RawCaptureItem = RawRecording | RawScreenshot;

export function isRawScreenshot(item: RawCaptureItem): item is RawScreenshot {
    return (item as RawScreenshot).kind === 'screenshot';
}

// ==========================================
// SCREENSHOT DOC (editor document)
// ==========================================

export interface ScreenshotSource {
    /** Cloud storage path: {userId}/screenshots/{screenshotId}/source.png */
    storagePath: string;
    /** Source image size in pixels (device pixels at capture) */
    widthPx: number;
    heightPx: number;
    devicePixelRatio: number;
    pageUrl?: string;
    pageTitle?: string;
    captureMode: ScreenshotCaptureMode;
}

/** Per-type defaults used when creating new annotations. */
export interface AnnotationDefaults {
    blurDefaults?: { blurRadiusPx: number };
    textDefaults?: { color: string; backgroundColor: string; fontSizePx: number };
    arrowDefaults?: { color: string; strokeWidthPx: number };
    borderDefaults?: { color: string; borderWidthPx: number };
}

/**
 * Coloured backdrop around the image, the screenshot counterpart of the
 * video editor's background colour + screen padding.
 */
export interface ScreenshotBackground {
    /** Off = no padding and no backdrop (the export is just the image) */
    enabled: boolean;
    colorMode: 'solid' | 'gradient';
    color: string;
    gradientColors: [string, string];
    /** Gradient angle in degrees (0-360). 0 = up, 90 = right, 180 = down, 270 = left */
    gradientDirection: number;
    /** Padding on every side as a fraction of the visible (cropped) image width, 0–0.25 */
    padding: number;
    /** Radius of all four image corners in px at a 1920 px wide view (scaled like the annotation effects) */
    borderRadiusPx: number;
}

/**
 * Dims everything outside one rectangle, like a video spotlight held for
 * its whole duration. A screenshot has at most one.
 */
export interface ScreenshotSpotlight {
    id: ID;
    /** The lit area in uncropped source pixels */
    rectPx: Rect;
    /** Per-corner radius [tl, tr, br, bl] in source pixels */
    borderRadiusPx: [number, number, number, number];
    /** Darkness outside the spotlight (0 = none, 1 = black) */
    dimOpacity: number;
    /** Feathered edge width in px at a 1920 px wide view (scaled like the annotation effects) */
    featherPx: number;
}

/**
 * The editor document stored in screenshots.screenshot_data.
 *
 * All spatial coordinates (crop, annotations, spotlight) are in UNCROPPED
 * source pixels: cropping is non-destructive and never shifts annotations.
 * The renderer translates by -crop.x/-crop.y (plus the background padding)
 * when drawing.
 */
export interface ScreenshotDoc {
    id: ID;
    schemaVersion: number;
    source: ScreenshotSource;
    /** Non-destructive crop in source pixels; null = full image */
    cropPx: Rect | null;
    /** Annotations in z-order (first = bottom) */
    annotations: OverlayItem[];
    annotationDefaults: AnnotationDefaults;
    background: ScreenshotBackground;
    /** null = no spotlight */
    spotlight: ScreenshotSpotlight | null;
}

/** Re-exported for convenience in screenshot modules. */
export type { Point, Rect, Size };
