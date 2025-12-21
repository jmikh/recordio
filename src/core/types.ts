
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

export interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}

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

    /* Background configuration for the canvas */
    background: BackgroundSettings;

    /**
     * Map of all Source assets used in the project.
     * Keyed by Source ID for O(1) lookup.
     */
    sources: Record<ID, Source>;

    /* The main timeline containing tracks and clips */
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

// ==========================================
// SOURCE
// ==========================================

/**
 * Represents a raw media asset (File) that has been imported.
 * Clips reference these Sources.
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
 * A Timeline represents a linear sequence of Tracks.
 */
export interface Timeline {
    id: ID;
    /** The main track containing clips */
    mainTrack: MainTrack;
    /** Optional overlay track (e.g. For Camera bubble) */
    overlayTrack?: Track;
    /** Total duration of the timeline */
    durationMs: TimeMs;
}

// ==========================================
// TRACK
// ==========================================

/**
 * A container for Clips.
 * Base Track interface for generic operations.
 * All clips on a track must be non-overlapping.
 */
export interface Track {
    id: ID;
    type: 'video' | 'audio' | 'overlay';
    name: string;

    // Constraints: Ordered by timelineIn, NO OVERLAPS allowed.
    /**
     * List of clips on this track.
     * MUST be sorted by `timelineInMs`.
     * MUST NOT overlap.
     */
    clips: Clip[];

    // State
    muted: boolean;
    locked: boolean;
    visible: boolean;
}

/**
 * Main Track containing specialized effects and settings.
 * Only one Main Track exists per project usually (for the main screen recording).
 */
export interface MainTrack extends Track {
    /** 
     * List of viewport motions (zoom/pan) applied to this track.
     * These define "viewport" movement over time.
     */
    viewportMotions: ViewportMotion[];

    /**
     * List of mouse effects (clicks, drags) derived from events.
     */
    mouseEffects?: MouseEffect[];

    /** Visual settings for how the clip is rendered */
    displaySettings: DisplaySettings;
}

// ==========================================
// CLIP
// ==========================================

/**
 * A Clip is a segment of a Source placed on the Timeline.
 * It maps a range of Source Time to a range of Timeline Time.
 */
export interface Clip {
    id: ID;
    /** ID of the Source media this clip plays */
    sourceId: ID;

    // Time Mapping
    /** Start time in the SOURCE video (trim/in-point) */
    sourceInMs: TimeMs;
    /** End time in the SOURCE video (trim/out-point) */
    sourceOutMs: TimeMs;

    /** Start time on the TIMELINE where this clip begins playing */
    timelineInMs: TimeMs;
    // timelineOutMs is derived: timelineInMs + (sourceOutMs - sourceInMs)

    // Properties
    /** Playback speed multiplier (1.0 = normal, 0.5 = slow, 2.0 = fast) */
    speed: number;

    // Linkage
    /**
     * If multiple clips share a linkGroupId, they are considered "linked"
     * and should be split, moved, or deleted together.
     * (e.g. keeping Audio and Video in sync)
     */
    linkGroupId?: string;

    audioVolume: number; // 0.0 to 1.0
    audioMuted: boolean;
}

export interface DisplaySettings {
    mode: 'fullscreen' | 'overlay';
    maxZoom: number; // Max zoom intensity (e.g. 2.0)
    backgroundColor: string;
    padding: number; // Proportional padding (0.0 to 1.0)
}

// ==========================================
// VIEWPORT MOTIONS
// ==========================================

export type EasingType = 'linear' | 'ease_in' | 'ease_out' | 'ease_in_out';

/**
 * Defines a viewport movement/state over time.
 * "Viewport Motion" model: The viewport moves from its previous state to the 'target' state
 * starting at 'timeInMs' and arriving at 'timeOutMs'.
 */
export interface ViewportMotion {
    id: ID;
    /** Start of the zoom/pan interpolation */
    timeInMs: TimeMs;
    /** End of the zoom/pan interpolation (arrival at target) */
    timeOutMs: TimeMs;

    /** The target viewport (visible frame) in source coordinates */
    viewport: Rect;

    easing: EasingType;
}

// ==========================================
// MOUSE EFFECTS
// ==========================================

export type MouseEffectType = 'click' | 'drag';

/**
 * Represents a visual mouse action derived from raw events.
 */
export interface MouseEffect {
    id: ID;
    type: MouseEffectType;

    /** Start playing this effect */
    timeInMs: TimeMs;
    /** Stop playing this effect */
    timeOutMs: TimeMs;

    // Data for Rendering
    start: Point;
    end?: Point;

    /** 
     * For Drags: The actual path of the mouse during the drag.
     * Contains sampled points with timestamps relative to the start of the effect? 
     * Or absolute timestamps? Absolute is easier for lookup.
     */
    path?: { timestamp: number; x: number; y: number }[];
}

// ==========================================
// USER EVENTS DURING RECORDING
// ==========================================

export interface Point { x: number; y: number; }
// Size is already defined above

export interface BaseEvent {
    timestamp: number;
}

export interface ClickEvent extends BaseEvent {
    type: 'click';
    x: number;
    y: number;
    tagName?: string;
}

export interface MouseEvent extends BaseEvent {
    type: 'mouse';
    x: number;
    y: number;
}

export interface UrlEvent extends BaseEvent {
    type: 'url';
    url: string;
}

export interface KeystrokeEvent extends BaseEvent {
    type: 'keydown';
    key: string;
    code: string;
    ctrlKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
    altKey: boolean;
    tagName?: string;
}

export interface MouseDownEvent extends BaseEvent {
    type: 'mousedown';
    x: number;
    y: number;
}

export interface MouseUpEvent extends BaseEvent {
    type: 'mouseup';
    x: number;
    y: number;
}

export type UserEvent = ClickEvent | MouseEvent | UrlEvent | KeystrokeEvent | MouseDownEvent | MouseUpEvent;

export interface ZoomConfig {
    zoomIntensity: number; // Global zoom setting (e.g. 1.0)
    zoomDuration: number; // Duration of validity (e.g. 2000ms)
    zoomOffset: number;   // Start time relative to event timestamp (e.g. -2000ms starts 2s before)
}


export type BackgroundType = 'solid' | 'image';

export interface BackgroundSettings {
    type: BackgroundType;
    color?: string; // Hex code, e.g. #FFFFFF
    imageUrl?: string; // Path to image (e.g. /assets/backgrounds/foo.jpg)
}
