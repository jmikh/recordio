/**
 * Caption Settings and Data
 */

import type { ID } from '@shared/types';

export interface CaptionSettings {
    visible: boolean;
    size: number; // Font size in pixels
    width: number; // Maximum width as percentage of canvas width (0-100)
    wordHighlight?: boolean; // Whether to progressively highlight words (karaoke-style)
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
