/**
 * Raw recording type for handoff between extension and webapp.
 */

import type { SourceMetadata } from './source';
import type { UserEvents } from './events';

/**
 * Lightweight recording data for handoff between extension and website.
 * This is NOT the full Project - it's the minimal data needed to create one.
 */
export interface RawRecording {
    id: string;
    name: string;
    timestamp: number; // createdAt timestamp

    screenSource: SourceMetadata;
    cameraSource?: SourceMetadata;
    userEvents: UserEvents;
}
