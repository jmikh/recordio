/**
 * Settings Types
 * 
 * All project configuration settings.
 */

import type { ID, Size, Rect } from '@shared/types';
import type { CaptionSegment } from './timeline';
import type { EasingStyle } from '../core/easing';

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
export type OutputCropOption = 'none' | '16:9' | '4:3' | '1:1' | '3:4' | '9:16';

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
    /** Easing curve applied to zoom transitions */
    easing: EasingStyle;
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
    /** Easing curve applied to spotlight transitions */
    easing: EasingStyle;
}

// ==========================================
// EFFECTS
// ==========================================

export type MouseClickEffectType = 'ring' | 'circle';

export interface MouseClickSettings {
    /** Whether the visual click effect is rendered. Sound can still play when this is off. */
    effectEnabled: boolean;
    /** Which visual effect to use for clicks */
    effectType: MouseClickEffectType;
    /** Color of the effect (hex string). Used by ring and circle effects. */
    color: string;
    /** Size multiplier (0.5–2.0). Scales the base radius. */
    size: number;
    /** Enable click sound effect */
    soundEnabled: boolean;
    /** Sound volume (0–1). Default: 0.5 */
    soundVolume: number;
}

export interface EffectSettings {
    showMouseDrags: boolean;
    showKeyboardClicks: boolean;
    /** Mouse click visual and sound configuration */
    mouseClick: MouseClickSettings;
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
// AUDIO
// ==========================================

export interface MusicSettings {
    /** Whether background music is enabled */
    enabled: boolean;
    /** Source type: CDN preset or user upload */
    source: 'preset' | 'custom';
    /** Volume level (0-1). Default: 0.3 */
    volume: number;
    /** CDN URL for preset music (source: 'preset') */
    presetUrl?: string;
    /** Display name of the selected preset */
    presetName?: string;
    /** Persistent URL for custom uploads (recordio-blob:// protocol) */
    customStorageUrl?: string;
    /** Transient blob URL (populated on load, never saved) */
    customRuntimeUrl?: string;
    /** ID of the global music library entry */
    customLibraryId?: string;
    /** Whether to fade out music near the end of the video */
    fadeOut: boolean;
    /** Fade out duration in milliseconds. Default: 3000 */
    fadeOutDurationMs: number;
}

export interface AudioSettings {
    /** Mute the microphone track */
    muteMicrophone: boolean;
    /** Mute the screen/system audio track */
    muteScreenAudio: boolean;
    /** Screen/system audio volume (0–1) */
    screenVolume: number;
    /** Microphone volume (0–1) */
    microphoneVolume: number;
    /** Background music settings */
    music: MusicSettings;
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

    // Audio
    audio: AudioSettings;
}

