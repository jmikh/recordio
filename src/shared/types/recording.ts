/**
 * Recording Types
 * 
 * Types for raw recordings captured by the extension.
 */

import type { SourceMetadata, UserEvents } from '../../core/types';

/**
 * Raw recording data from the extension, before it becomes a Project.
 */
export interface RawRecording {
    id: string;
    name: string;
    timestamp: number;
    screenSource: SourceMetadata;
    cameraSource?: SourceMetadata;
    userEvents: UserEvents;
}
