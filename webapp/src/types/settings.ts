/**
 * Settings Types
 * 
 * All project configuration settings.
 */

import type { ID, Size, Rect } from '@shared/types';
import type { CaptionSegment } from './timeline';

// ==========================================
// STYLE (base for camera/screen)
// ==========================================

/**
 * Shared visual style properties for screen and camera.
 */
export interface StyleSettings {
    /** 
     * Corner radius in output pixels.
     * Applied uniformly to create circular corners (not elliptical).
     * Clamped to half of smaller dimension during rendering.
     */
    borderRadius: number;
    borderWidth: number;
    borderColor: string; // Used for border and glow/shadow color
    hasShadow: boolean;
    hasGlow: boolean;
}

// ==========================================
// CAMERA
// ==========================================

export interface CameraSettings extends StyleSettings {
    width: number;
    height: number;
    x: number;
    y: number;
    shape: 'circle' | 'rect' | 'square';

    /** Zoom/crop within the camera video feed (1x = no crop, 3x = 3x zoom) */
    cropZoom: number;

    /** Enable auto-shrink when screen is zoomed in */
    autoShrink?: boolean;

    /** Scale factor when shrunk (0.25 = 25%, 0.5 = 50%, 0.75 = 75%). Default: 0.5 */
    shrinkScale?: number;
}

// ==========================================
// SCREEN
// ==========================================

/** Supported aspect ratio presets for output video crop */
export type OutputCropOption = 'none' | '16:9' | '4:3' | '1:1' | '9:16';

export interface ScreenSettings extends StyleSettings {
    mode: 'device' | 'border';
    deviceFrameId?: ID;
    crop?: Rect;
    padding: number;
    mute: boolean; // defaults to false
    /** Output video crop aspect ratio. 'none' = original aspect ratio */
    outputCrop?: OutputCropOption;
}

// ==========================================
// BACKGROUND
// ==========================================

export interface BackgroundSettings {
    type: 'color' | 'preset' | 'custom';
    color: string;
    gradientColors: [string, string];
    /** Gradient angle in degrees (0-360). 0 = up, 90 = right, 180 = down, 270 = left */
    gradientDirection: number;
    /** Static URL for preset backgrounds (type: 'preset') */
    imageUrl?: string;
    /** Persistent URL for custom uploads (type: 'custom'). recordio-blob:// protocol. */
    customStorageUrl?: string;
    /** Transient blob URL for custom uploads. Populated on load, never saved. */
    customRuntimeUrl?: string;
    /** ID of the global library entry this background came from. Used for matching. */
    customLibraryId?: string;
    colorMode: 'gradient' | 'solid';
    backgroundBlur: number;
}

export type BackgroundType = 'solid' | 'image';

// ==========================================
// ZOOM
// ==========================================

export interface ZoomSettings {
    maxZoom: number;
    isAuto: boolean;
    maxZoomDurationMs: number;
    minZoomDurationMs: number;
}

// ==========================================
// SPOTLIGHT
// ==========================================

export interface SpotlightSettings {
    /** Whether to automatically generate spotlights from hovered cards. Default: true */
    isAuto: boolean;
    /** Dim opacity for background (0 = no dim, 1 = fully black). Default: 0.5 */
    dimOpacity: number;
    /** Scale factor when spotlight is active (1.0 = no scale, 1.1 = 10% larger). Default: 1.1 */
    enlargeScale: number;
    /** Transition duration in milliseconds for fade in/out. Default: 300 */
    transitionDurationMs: number;
    /** Minimum hold duration in milliseconds (the shortest a spotlight can be). Default: 200 */
    minHoldDurationMs: number;
    /** Default hold duration in milliseconds (preferred when adding new spotlight). Default: 1000 */
    defaultHoldDurationMs: number;
}

// ==========================================
// EFFECTS
// ==========================================

export interface EffectSettings {
    showMouseClicks: boolean;
    showMouseDrags: boolean;
    showKeyboardClicks: boolean;
}

// ==========================================
// CAPTIONS (settings only, data is in timeline)
// ==========================================

export interface CaptionSettings {
    visible: boolean;
    size: number; // Font size in pixels
    width: number; // Maximum width as percentage of canvas width (0-100)
    color?: string; // Text color in hex format (e.g. '#ffffff')
    wordHighlight?: boolean; // Whether to progressively highlight words (karaoke-style)
    /** Baseline captions from last successful transcription (never modified by editing) */
    baselineCaptions?: CaptionSegment[];
    /** When captions were generated (if any) */
    generatedAt?: Date;
}

// ==========================================
// PROJECT SETTINGS (aggregated)
// ==========================================

export interface ProjectSettings {
    outputSize: Size;
    frameRate: number;

    // Zoom
    zoom: ZoomSettings;

    // Spotlight
    spotlight: SpotlightSettings;

    // Effects
    effects: EffectSettings;

    // Background
    background: BackgroundSettings;

    // Screen Content
    screen: ScreenSettings;

    // Camera
    camera?: CameraSettings;

    // Captions
    captions: CaptionSettings;
}

