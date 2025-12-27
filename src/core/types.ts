
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

    /* Unified Settings */
    settings: ProjectSettings;

    /**
     * Map of all Source assets used in the project.
     * Keyed by Source ID for O(1) lookup.
     */
    sources: Record<ID, SourceMetadata>;

    /* The main timeline containing the recording and output windows */
    timeline: Timeline;
}

export interface ProjectSettings {
    // Output
    outputSize: Size;
    frameRate: number;

    // Zoom
    maxZoom: number;
    autoZoom: boolean;

    // Background
    backgroundType: 'solid' | 'image';
    backgroundColor: string;
    padding: number;
    backgroundImageUrl?: string;
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
    createdAt?: number;
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
}

/**
 * Represents the recording session data.
 */
export interface Recording {
    /** Time from the beginning of the timeline at which video starts (defaults to 0) */
    timelineOffsetMs: TimeMs;

    screenSourceId: ID;
    cameraSourceId?: ID;

    viewportMotions: ViewportMotion[];
}


// ==========================================
// VIEWPORT MOTIONS
// ==========================================

export interface ViewportMotion {
    /** End time in SOURCE time. */
    sourceEndTimeMs: TimeMs;
    durationMs: TimeMs;
    rect: Rect;
    reason: string;
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
}

export interface TypingEvent extends BaseEvent {
    type: typeof EventType.TYPING;
    targetRect: Rect;
    endTime: number;
}

// In UserEvent Union
export type UserEvent = MouseClickEvent | MousePositionEvent | UrlChangeEvent | KeyboardEvent | HoverEvent | DragEvent | ScrollEvent | TypingEvent;

export type BackgroundType = 'solid' | 'image';