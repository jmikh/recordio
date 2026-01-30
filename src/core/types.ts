
// ==========================================
// CONFIG & SHARED
// ==========================================

export type ID = string;

/**
 * Represents time in Milliseconds.
 * All time values in the core engine use this unit.
 */
export type TimeMs = number;

export interface Point {
    x: number;
    y: number;
}

export interface Size {
    width: number;
    height: number;
}

// The rect point represents the top-left corner.
export interface Rect extends Point, Size { }

// ==========================================
// PROJECT
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

    /* Unified Settings */
    settings: ProjectSettings;

    /* The main timeline containing the recording and output windows */
    timeline: Timeline;
}

// Shared visual style properties
export interface StyleSettings {
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
    type: 'solid' | 'gradient' | 'image';
    color: string;
    gradientColors: [string, string];
    gradientDirection: 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW';
    imageUrl?: string; // For presets
    sourceId?: string; // For 'image' type (uploaded)
    customSourceId?: string; // For 'image' type (uploaded)
    lastColorMode: 'gradient' | 'solid'; // To remember state
    backgroundBlur: number;
}

export interface ZoomSettings {
    maxZoom: number;
    autoZoom: boolean;
    maxZoomDurationMs: number;
    minZoomDurationMs: number;
}

export interface SpotlightSettings {
    /** Dim opacity for background (0 = no dim, 1 = fully black). Default: 0.5 */
    dimOpacity: number;
    /** Scale factor when spotlight is active (1.0 = no scale, 1.1 = 10% larger). Default: 1.1 */
    enlargeScale: number;
    /** Transition duration in milliseconds for fade in/out. Default: 300 */
    transitionDurationMs: number;
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
// SOURCE
// ==========================================

/**
 * Represents a raw media asset (File) that has been imported.
 * Heavy event data is stored externally and referenced via eventsUrl.
 */
export interface SourceMetadata {
    id: ID;
    type: 'video' | 'audio' | 'image';
    /** URL to the media file (blob or remote) */
    url: string;

    // Pointer to the external JSON containing UserEvents
    eventsUrl?: string;

    // Metadata
    /** Total duration of the source file in milliseconds */
    durationMs: TimeMs;
    size: Size;
    /** Frames Per Second (Video only) */
    fps?: number;
    hasAudio: boolean;
    has_microphone: boolean;
    fileSizeBytes?: number;
    createdAt?: number;
    /** Human readable name of the source (e.g. Tab Title or "Desktop") */
    name: string;
}

// ==========================================
// EXTERNAL USER EVENTS
// ==========================================

/**
 * Structure of the external JSON file pointed to by SourceMetadata.eventsUrl.
 * Contains raw recorded interactions categorized by type.
 */
export interface UserEvents {
    mouseClicks: BaseEvent[];
    mousePositions: BaseEvent[];
    keyboardEvents: KeyboardEvent[];
    drags: DragEvent[];
    scrolls: BaseEvent[];
    typingEvents: BaseEvent[];
    urlChanges: BaseEvent[];
    hoveredCards: HoveredCardEvent[];

    /**
     * Pre-sorted aggregate of all non-mouse-position events (clicks, typing, drags, scrolls, urlChanges, hoveredCards).
     * Computed at runtime when events are loaded in useProjectStore. NOT persisted to storage.
     */
    allEvents: BaseEvent[];
}


// ==========================================
// TIMELINE
// ==========================================

/**
 * A Timeline represents the sequence of events.
 * It contains a single Recording and multiple OutputWindows.
 */
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

    /** ID of the screen source for this timeline */
    screenSourceId: ID;
    /** Optional ID of the camera source */
    cameraSourceId?: ID;
    /** Zoom action keyframes for zoom/pan effects */
    zoomActions: ZoomAction[];
    /** Spotlight regions for spotlight effect (non-overlapping) */
    spotlights: Spotlight[];
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
// SPOTLIGHT
// ==========================================

/**
 * A spotlight is a finite-duration effect that dims the background
 * and enlarges a specific region with smooth transitions.
 * The spotlight region is defined in SOURCE coordinates (original screen recording).
 */
export interface Spotlight {
    id: ID;
    /** Output time when the spotlight starts (in output coordinate system) */
    outputStartTimeMs: TimeMs;
    /** Output time when the spotlight ends (in output coordinate system) */
    outputEndTimeMs: TimeMs;
    /** The rectangle to spotlight (in SOURCE video coordinates) */
    sourceRect: Rect;
    /** Border radius as percentage of the smaller dimension (0 = rectangle, 50 = fully circular/pill) */
    borderRadius: number;
    /** Optional reason/label for the spotlight */
    reason?: string;
    /** How the spotlight was created */
    type: 'auto' | 'manual';
}

/**
 * Represents a drag action.
 */
export interface DragEvent extends BaseEvent {
    type: typeof EventType.MOUSEDRAG;
    endTime: number;
}

// ==========================================
// USER EVENTS DURING RECORDING
// ==========================================

// Size is already defined above

// Size is already defined above

export const EventType = {
    CLICK: 'click',
    MOUSEPOS: 'mousepos',
    URLCHANGE: 'urlchange',
    KEYDOWN: 'keydown',
    HOVER: 'hover',
    MOUSEDRAG: 'mousedrag',
    SCROLL: 'scroll',
    TYPING: 'typing',
    HOVERED_CARD: 'hoveredCard'
} as const;

export type EventType = typeof EventType[keyof typeof EventType];

export interface BaseEvent {
    type: EventType;
    timestamp: number;
    mousePos: Point;
    targetRect?: Rect;
    endTime?: number;
}

// KeyboardEvent has unique fields beyond BaseEvent
export interface KeyboardEvent extends BaseEvent {
    type: typeof EventType.KEYDOWN;
    key: string;
    code: string;
    ctrlKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
    altKey: boolean;
    tagName?: string;
}

// HoveredCardEvent has unique cornerRadius field
export interface HoveredCardEvent extends BaseEvent {
    type: typeof EventType.HOVERED_CARD;
    targetRect: Rect;
    endTime: number;
    cornerRadius: [number, number, number, number]; // [tl, tr, br, bl]
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

export interface CameraSettings {
    width: number;
    height: number;
    x: number;
    y: number;
    shape: 'circle' | 'rect' | 'square';
    borderRadius: number;
    borderWidth: number;
    borderColor: string;
    hasShadow: boolean;
    hasGlow: boolean;

    /** Zoom/crop within the camera video feed (1x = no crop, 3x = 3x zoom) */
    cropZoom: number;

    /** Enable auto-shrink when screen is zoomed in */
    autoShrink?: boolean;

    /** Scale factor when shrunk (0.25 = 25%, 0.5 = 50%, 0.75 = 75%). Default: 0.5 */
    shrinkScale?: number;
}