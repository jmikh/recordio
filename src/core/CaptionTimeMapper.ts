import type { CaptionSegment } from './types';
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
}
