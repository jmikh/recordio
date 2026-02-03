import type { CaptionSegment } from '../types';
import { TimeMapper } from './timeMapper';

/**
 * Maps transcription segments from source time to output time,
 * handling window splits, gaps, and speed adjustments.
 */
export class CaptionTimeMapper {
    private segments: CaptionSegment[];
    private timeMapper: TimeMapper;

    constructor(
        segments: CaptionSegment[],
        timeMapper: TimeMapper
    ) {
        this.segments = segments;
        this.timeMapper = timeMapper;
    }

    /**
     * Get all caption segments visible at a given output time.
     * Returns an array because multiple segments might be visible simultaneously
     * (though typically there will be 0 or 1).
     * 
     * @param outputTimeMs - The output time in milliseconds
     * @returns Array of visible segments
     */
    getCaptionsAtOutputTime(outputTimeMs: number): CaptionSegment[] {
        const sourceTime = this.timeMapper.mapOutputToSourceTime(outputTimeMs);

        if (sourceTime === -1) {
            return []; // Output time is in a gap
        }

        return this.segments.filter(segment =>
            sourceTime >= segment.sourceStartMs && sourceTime < segment.sourceEndMs
        );
    }

    /**
     * Map a segment from source time to output time range(s).
     * Returns null if the segment is completely hidden (falls in a gap).
     * Returns a single range if the segment is fully visible.
     * 
     * Note: Currently returns single range representing first visible portion.
     * If needed, this could be extended to return multiple ranges for segments
     * that span multiple windows with gaps in between.
     * 
     * @param segment - The transcription segment
     * @returns Output time range or null if not visible
     */
    mapSegmentToOutputRange(segment: CaptionSegment): { start: number; end: number } | null {
        return this.timeMapper.mapSourceRangeToOutputRange(
            segment.sourceStartMs,
            segment.sourceEndMs
        );
    }

    /**
     * Get all segments that are visible in the output timeline.
     * Useful for filtering out segments that fall entirely in gaps.
     */
    getVisibleSegments(): Array<CaptionSegment & { outputRange: { start: number; end: number } }> {
        const visible: Array<CaptionSegment & { outputRange: { start: number; end: number } }> = [];

        for (const segment of this.segments) {
            const outputRange = this.mapSegmentToOutputRange(segment);
            if (outputRange) {
                visible.push({ ...segment, outputRange });
            }
        }

        return visible;
    }

    /**
     * Calculates which word should be highlighted based on elapsed time in segment.
     * Uses letter count + base value for proportional timing.
     * 
     * @param words Array of words in the segment
     * @param elapsedRatio How far through the segment we are (0-1)
     * @returns Index of the word that should be highlighted, or -1 if no words
     */
    getHighlightedWordIndex(words: string[], elapsedRatio: number): number {
        if (words.length === 0) return -1;
        if (words.length === 1) return 0;

        // Base value added to each word's letter count for more even distribution
        const WORD_BASE_VALUE = 3;

        // Calculate weighted values for each word (letter count + base)
        const weights = words.map(word => word.length + WORD_BASE_VALUE);
        const totalWeight = weights.reduce((sum, w) => sum + w, 0);

        // Find which word we're in based on cumulative thresholds
        let cumulative = 0;
        for (let i = 0; i < words.length; i++) {
            cumulative += weights[i] / totalWeight;
            if (elapsedRatio < cumulative) {
                return i;
            }
        }

        // Edge case: exactly at 1.0
        return words.length - 1;
    }
}
