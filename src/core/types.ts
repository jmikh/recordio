
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
    zoom: number;
}

export interface ScreenSettings extends StyleSettings {
    mode: 'device' | 'border';
    deviceFrameId?: ID;
    crop?: Rect;
    padding: number;
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

export interface CaptionSettings {
    visible: boolean;
    size: number; // Font size in pixels
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
    mouseClicks: MouseClickEvent[];
    mousePositions: MousePositionEvent[]; // mousepos
    keyboardEvents: KeyboardEvent[];
    drags: DragEvent[];
    scrolls: ScrollEvent[];
    typingEvents: TypingEvent[];
    urlChanges: UrlChangeEvent[];
}


// ==========================================
// TIMELINE
// ==========================================

/**
 * A Timeline represents the sequence of events.
 * It contains a single Recording and multiple OutputWindows.
 */
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

    /** The single recording containing source references and events */
    recording: Recording;
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

/**
 * Represents the recording session data.
 */
export interface Recording {
    screenSourceId: ID;
    cameraSourceId?: ID;

    viewportMotions: ViewportMotion[];

    /** Optional caption data from webcam audio */
    captions?: Captions;
}


// ==========================================
// VIEWPORT MOTIONS
// ==========================================

export interface ViewportMotion {
    id: ID;
    outputEndTimeMs: TimeMs;
    durationMs: TimeMs;
    rect: Rect;
    reason: string;
    type: 'auto' | 'manual';
}

/**
 * Represents a drag action.
 */
export interface DragEvent extends BaseEvent {
    type: typeof EventType.MOUSEDRAG;
    path: MousePositionEvent[];
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
    TYPING: 'typing'
} as const;

export type EventType = typeof EventType[keyof typeof EventType];

export interface BaseEvent {
    type: EventType;
    timestamp: number;
    mousePos: Point;
}

export interface MouseClickEvent extends BaseEvent {
    type: typeof EventType.CLICK;
}

export interface MousePositionEvent extends BaseEvent {
    type: typeof EventType.MOUSEPOS;
}

export interface UrlChangeEvent extends BaseEvent {
    type: typeof EventType.URLCHANGE;
    url: string;
    title?: string;
}

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

export interface HoverEvent extends BaseEvent {
    type: typeof EventType.HOVER;
    endTime: number;
}


export interface ScrollEvent extends BaseEvent {
    type: typeof EventType.SCROLL;
    targetRect: Rect;
    endTime: number;
}

export interface TypingEvent extends BaseEvent {
    type: typeof EventType.TYPING;
    targetRect: Rect;
    endTime: number;
}

// In UserEvent Union
export type UserEvent = MouseClickEvent | MousePositionEvent | UrlChangeEvent | KeyboardEvent | HoverEvent | DragEvent | ScrollEvent | TypingEvent;


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
    zoom: number;
}