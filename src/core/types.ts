
// ==========================================
// CONFIG & SHARED
// ==========================================

export type ID = string;

/**
 * Represents time in Milliseconds.
 * All time values in the core engine use this unit.
 */
export type TimeMs = number;

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

    /** Global output settings for rendering */
    outputSettings: OutputSettings;

    /**
     * Map of all Source assets used in the project.
     * Keyed by Source ID for O(1) lookup.
     */
    sources: Record<ID, Source>;

    /** The main timeline containing tracks and clips */
    timeline: Timeline;
}

/**
 * Configuration for the final video output.
 */
export interface OutputSettings {
    width: number;
    height: number;
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
    width: number;
    height: number;
    /** Frames Per Second (Video only) */
    fps?: number;
    hasAudio: boolean;
}

// ==========================================
// TIMELINE
// ==========================================

/**
 * A Timeline represents a linear sequence of Tracks.
 */
export interface Timeline {
    id: ID;
    /** List of tracks, ordered by vertical staking order (bottom to top usually) */
    tracks: Track[];
    /** Total duration of the timeline (max of all tracks) */
    durationMs: TimeMs;
}

// ==========================================
// TRACK
// ==========================================

/**
 * A container for Clips and Effects.
 * Tracks enable compositing and mixing.
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

    /** Effects representing global transformations on this track */
    effects: TrackEffect[];

    // State
    muted: boolean;
    locked: boolean;
    visible: boolean;
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

// ==========================================
// EFFECT
// ==========================================

export type EasingType = 'linear' | 'ease_in' | 'ease_out' | 'ease_in_out';

/**
 * An effect applied to a Track.
 */
export interface TrackEffect {
    id: ID;
    type: 'zoom_pan';
    // Potential for other types: 'color_grade', 'opacity', etc.

    keyframes: Keyframe[];
}

/**
 * A point in time defining a property value for animation.
 */
export interface Keyframe {
    id: ID;
    /** Time on the TIMELINE when this keyframe occurs */
    timeMs: TimeMs;
    easing: EasingType;

    // Value (Structure depends on Effect Type)
    // For ZoomPan:
    value: {
        x: number;      // Center X 
        y: number;      // Center Y
        scale: number;  // Zoom Level
    }
}
