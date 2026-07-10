/**
 * Project Type
 * 
 * The root entity of the video editor.
 */

import type { ID, ScreenMetadata, CameraMetadata, MicrophoneMetadata } from './core';
import type { UserEvents } from './events';
import type { ProjectSettings } from './settings';
import type { Timeline } from './timeline';

/**
 * The Root Entity of the Video Editor.
 * Contains all sources, the timeline, and global settings.
 *
 * ## userEvents Separation (Runtime vs Persistence)
 *
 * In IndexedDB, `userEvents` is stored as part of the full Project record.
 * However, at runtime the project store (`useProjectStore`) strips `userEvents`
 * out of `project` on load and holds them in a separate top-level `userEvents`
 * field. This prevents the (potentially massive) event arrays from being
 * snapshot on every undo/redo operation.
 *
 * **Implications:**
 * - `useProjectData()` / `s.project` does NOT contain `userEvents` at runtime.
 * - Access events via `useProjectStore(s => s.userEvents)` or `useUserEvents()`.
 * - When passing a full project to functions that need events (e.g. export,
 *   analytics), reconstruct it: `{ ...project, userEvents: store.userEvents }`.
 * - Auto-save re-attaches `userEvents` before writing to IndexedDB.
 */
export interface Project {
    id: ID;
    /** Schema version for migration support. Start at 1. */
    schemaVersion: number;
    /** URL (blob or remote) to project, or just a generic placeholder if undefined */
    thumbnail?: string;
    /**
     * Whether auto zoom/spotlight segments (and focus areas) have been
     * generated from userEvents. False at creation; the editor generates them
     * on first open and flips this to true. Never regenerate once true — an
     * empty zoomSegments array may mean the user deleted them.
     */
    autoEffectsGenerated: boolean;

    /** Screen recording source metadata (always present) */
    screenSource: ScreenMetadata;
    /** Camera recording source metadata (optional) */
    cameraSource?: CameraMetadata;
    /** Microphone audio source metadata (optional, standalone track) */
    microphoneSource?: MicrophoneMetadata;
    /**
     * User interaction events captured during recording.
     *
     * ⚠️  At runtime this field is EMPTY on `useProjectData()` — the store
     * strips it on load for undo/redo performance. Read events from
     * `useProjectStore(s => s.userEvents)` instead. See class-level JSDoc.
     */
    userEvents: UserEvents;

    /* Unified Settings */
    settings: ProjectSettings;

    /* The main timeline containing the recording and output windows */
    timeline: Timeline;
}