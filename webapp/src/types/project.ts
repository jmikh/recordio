
// ==========================================
// SHARED TYPES (from @shared/types)
// ==========================================

// Re-export core primitives from shared
export type { ID, TimeMs, Point, Size, Rect } from '@shared/types/core';
export type {
    BaseEvent,
    KeyboardEvent,
    HoveredCardEvent,
    DragEvent,
    UserEvents
} from '@shared/types/events';
export { EventType } from '@shared/types/events';
export type { SourceMetadata } from '@shared/types/source';

// Import for use within this file
import type { ID, TimeMs, Point, Size, Rect } from '@shared/types/core';
import type { UserEvents } from '@shared/types/events';
import type { SourceMetadata } from '@shared/types/source';

// ==========================================
// PROJECT (webapp-specific)
// ==========================================

/**
 * The Root Entity of the Video Editor.
 * Contains all sources, the timeline, and global settings.
 */
export interface Project {
    id: ID;
    /** Human-readable name of the project */
    name: string;
    createdAt: Date;
    updatedAt: Date;
    /** URL (blob or remote) to project, or just a generic placeholder if undefined */
    thumbnail?: string;

    /** Screen recording source metadata (always present) */
    screenSource: SourceMetadata;
    /** Camera recording source metadata (optional) */
    cameraSource?: SourceMetadata;
    /** User interaction events from the recording */
    userEvents: UserEvents;

    /* Unified Settings */
    settings: ProjectSettings;

    /* The main timeline containing the recording and output windows */
    timeline: Timeline;
}

// Shared visual style properties
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

export interface ScreenSettings extends StyleSettings {
    mode: 'device' | 'border';
    deviceFrameId?: ID;
    crop?: Rect;
    padding: number;
    mute: boolean; // defaults to false
}

export interface BackgroundSettings {
    type: 'color' | 'preset' | 'custom';
    color: string;
    gradientColors: [string, string];
    gradientDirection: 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW';
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

export interface ZoomSettings {
    maxZoom: number;
    isAuto: boolean;
    maxZoomDurationMs: number;
    minZoomDurationMs: number;
}

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

export interface EffectSettings {
    showMouseClicks: boolean;
    showMouseDrags: boolean;
    showKeyboardClicks: boolean;
}

export interface CaptionSettings {
    visible: boolean;
    size: number; // Font size in pixels
    width: number; // Maximum width as percentage of canvas width (0-100)
    wordHighlight?: boolean; // Whether to progressively highlight words (karaoke-style)
}

/**
 * Represents a single caption segment.
 * Timestamps are in source time (raw video time before windows/speed adjustments).
 */
export interface CaptionSegment {
    id: ID;
    text: string;
    /** Start time in source video (milliseconds) */
    sourceStartMs: number;
    /** End time in source video (milliseconds) */
    sourceEndMs: number;
}

/**
 * Complete caption data for a recording.
 */
export interface Captions {
    segments: CaptionSegment[];
    generatedAt: Date;
}

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

// ==========================================
// TIMELINE
// ==========================================

/**
 * Represents a focus area for zoom targeting.
 * Stored in Timeline and computed from user events.
 */
export interface FocusArea {
    timestamp: number;  // Output time when this focus area applies
    rect: Rect;         // The focus rectangle in source coordinates
    reason: string;     // Why this focus area was returned (event type, 'hover', or 'inactivity')
}

export interface Timeline {
    id: ID;
    /** Total duration of the timeline in milliseconds */
    durationMs: TimeMs;

    /**
     * Ordered non-overlapping windows of time fitting inside duration 
     * that will be outputted in the final video.
     * Defaulted to screenSource duration.
     */
    outputWindows: OutputWindow[];

    /** Zoom action keyframes for zoom/pan effects */
    zoomActions: ZoomAction[];
    /** Spotlight action keyframes for spotlight effect (non-overlapping) */
    spotlightActions: SpotlightAction[];
    /** Optional caption data from webcam audio */
    captions?: Captions;
    /** Cached focus areas computed from user events and output windows */
    focusAreas: FocusArea[];
}

/**
 * Defines a segment of the timeline that will be included in the final output.
 */
export interface OutputWindow {
    id: ID;
    /** Timeline-based start time */
    startMs: TimeMs;
    /** Timeline-based end time */
    endMs: TimeMs;
    /** Playback speed multiplier (default: 1.0). 2.0 = 2x speed, 0.5 = 0.5x speed */
    speed?: number;
}




// ==========================================
// ZOOM ACTIONS
// ==========================================

export interface ZoomAction {
    id: ID;
    outputEndTimeMs: TimeMs;
    durationMs: TimeMs;
    rect: Rect;
    reason: string;
    type: 'auto' | 'manual';
}

// ==========================================
// SPOTLIGHT ACTIONS
// ==========================================

/**
 * A spotlight action is a finite-duration effect that dims the background
 * and enlarges a specific region with smooth transitions.
 * The spotlight region is defined in SOURCE coordinates (original screen recording).
 */
export interface SpotlightAction {
    id: ID;
    /** Output time when the spotlight starts (in output coordinate system) */
    outputStartTimeMs: TimeMs;
    /** Output time when the spotlight ends (in output coordinate system) */
    outputEndTimeMs: TimeMs;
    /** The rectangle to spotlight (in SOURCE video coordinates) */
    sourceRect: Rect;
    /** Border radius in pixels for each corner [topLeft, topRight, bottomRight, bottomLeft] (in OUTPUT coordinates) */
    borderRadius: [number, number, number, number];
    /** Scale factor for this spotlight (capped to fit within output bounds) */
    scale: number;
    /** Optional reason/label for the spotlight */
    reason?: string;
}


export type BackgroundType = 'solid' | 'image';

// ==========================================
// DEVICE FRAMES
// ==========================================

export interface DeviceFrame {
    id: ID;
    name: string;
    imageUrl: string;
    thumbnailUrl: string;
    // The inner screen rectangle in the frame image (relative to image 0,0)
    // Used to calculate border thickness ratios
    screenRect: Rect;
    // Total size of the frame image
    size: Size;
    borderData: FrameBorderData;
    customScaling?: FrameScalingConfig;
}

export interface FrameScalingConfig {
    vertical: SliceSegment[];
    horizontal: SliceSegment[];
}

export interface SliceSegment {
    start: number;
    end: number;
    scalable: boolean;
}

export interface FrameBorderData {
    // Ratios of border thickness to total size (0..1)
    top: number;
    bottom: number;
    left: number;
    right: number;
}