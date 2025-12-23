
// ==========================================
// CONFIG & SHARED
// ==========================================

export type ID = string;

/**
 * Represents time in Milliseconds.
 * All time values in the core engine use this unit.
 */
export type TimeMs = number;

export interface Size {
    width: number;
    height: number;
}

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

    /* Global output settings for rendering */
    outputSettings: OutputSettings;

    /* Zoom configuration */
    zoom: ZoomSettings;

    /* Background configuration for the canvas */
    background: BackgroundSettings;

    /**
     * Map of all Source assets used in the project.
     * Keyed by Source ID for O(1) lookup.
     */
    sources: Record<ID, Source>;

    /* The main timeline containing the recording and output windows */
    timeline: Timeline;
}

/**
 * Configuration for the final video output.
 */
export interface OutputSettings {
    size: Size;
    frameRate: number;
    // We can add bitrate/etc later
}

export interface ZoomSettings {
    maxZoom: number;
    auto: boolean;
}

// ==========================================
// SOURCE
// ==========================================

/**
 * Represents a raw media asset (File) that has been imported.
 */
export interface Source {
    id: ID;
    type: 'video' | 'audio' | 'image';
    /** URL to the media file (blob or remote) */
    url: string;

    // Metadata
    /** Total duration of the source file in milliseconds */
    durationMs: TimeMs;
    size: Size;
    /** Frames Per Second (Video only) */
    fps?: number;
    hasAudio: boolean;
    events?: UserEvent[];
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
}

/**
 * Represents the recording session data.
 */
export interface Recording {
    /** Time from the beginning of the timeline at which video starts (defaults to 0) */
    timelineOffsetMs: TimeMs;

    screenSourceId: ID;
    cameraSourceId?: ID;

    clickEvents: ClickEvent[];
    dragEvents: DragEvent[];
    keyboardEvents: KeyboardEvent[];

    viewportMotions: ViewportMotion[];
}


// ==========================================
// VIEWPORT MOTIONS
// ==========================================

export interface ViewportMotion {
    /** End time in OUTPUT time (gapless). */
    endTimeMs: TimeMs;
    durationMs: TimeMs;
    rect: Rect;
}

/**
 * Represents a drag action.
 */
export interface DragEvent extends BaseEvent {
    type: 'drag';
    path: TimestampedPoint[];
}

// ==========================================
// USER EVENTS DURING RECORDING
// ==========================================

export interface Point { x: number; y: number; }
// Size is already defined above

export interface TimestampedPoint extends Point {
    timestamp: number;
}

export interface BaseEvent {
    timestamp: number;
}

export interface ClickEvent extends BaseEvent, Point {
    type: 'click';
    tagName?: string;
}

export interface MouseEvent extends BaseEvent, Point {
    type: 'mouse';
}

export interface UrlEvent extends BaseEvent {
    type: 'url';
    url: string;
}

export interface KeyboardEvent extends BaseEvent {
    type: 'keydown';
    key: string;
    code: string;
    ctrlKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
    altKey: boolean;
    tagName?: string;
}

export interface MouseDownEvent extends BaseEvent, Point {
    type: 'mousedown';
}

export interface MouseUpEvent extends BaseEvent, Point {
    type: 'mouseup';
}

export interface HoverEvent extends BaseEvent, Point {
    type: 'hover';
    endTime: number;
}

export type UserEvent = ClickEvent | MouseEvent | UrlEvent | KeyboardEvent | MouseDownEvent | MouseUpEvent | HoverEvent | DragEvent;

export type BackgroundType = 'solid' | 'image';

export interface BackgroundSettings {
    type: BackgroundType;
    color?: string; // Hex code, e.g. #FFFFFF
    imageUrl?: string; // Path to image (e.g. /assets/backgrounds/foo.jpg)
    /** Scale padding percentage (0 to 0.5). Default 0.1 (10%) */
    padding?: number;
}

