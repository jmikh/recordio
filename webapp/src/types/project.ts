/**
 * Project Type
 * 
 * The root entity of the video editor.
 */

import type { ID } from '@shared/types';
import type { ScreenMetadata, CameraMetadata, MicrophoneMetadata, UserEvents } from '@shared/types';
import type { ProjectSettings } from './settings';
import type { Timeline } from './timeline';

/**
 * The Root Entity of the Video Editor.
 * Contains all sources, the timeline, and global settings.
 */
export interface Project {
    id: ID;
    /** Schema version for migration support. Start at 1. */
    schemaVersion: number;
    /** Human-readable name of the project */
    name: string;
    createdAt: Date;
    updatedAt: Date;
    /** URL (blob or remote) to project, or just a generic placeholder if undefined */
    thumbnail?: string;

    /** Screen recording source metadata (always present) */
    screenSource: ScreenMetadata;
    /** Camera recording source metadata (optional) */
    cameraSource?: CameraMetadata;
    /** Microphone audio source metadata (optional, standalone track) */
    microphoneSource?: MicrophoneMetadata;
    /** User interaction events from the recording */
    userEvents: UserEvents;

    /* Unified Settings */
    settings: ProjectSettings;

    /* The main timeline containing the recording and output windows */
    timeline: Timeline;
}