import { TimeMapper } from '../../core/timeMapper';

/**
 * Utility for converting between timeline pixel positions and time values.
 * Wraps TimeMapper and pixelsPerSec for clean, reusable conversions.
 */
export class TimePixelMapper {
    private timeMapper: TimeMapper;
    private pixelsPerSec: number;

    constructor(timeMapper: TimeMapper, pixelsPerSec: number) {
        this.timeMapper = timeMapper;
        this.pixelsPerSec = pixelsPerSec;
    }

    /**
     * Convert x pixels to output time in milliseconds.
     * Used for mouse interactions (click, hover, drag delta).
     */
    xToMs(x: number): number {
        return (x / this.pixelsPerSec) * 1000;
    }

    /**
     * Convert output time in milliseconds to x pixels.
     * Used for rendering positions and widths.
     */
    msToX(ms: number): number {
        return (ms / 1000) * this.pixelsPerSec;
    }

    /**
     * Convert source time to x pixels (chains through TimeMapper).
     * Returns -1 if source time is not in any output window.
     */
    sourceTimeToX(sourceTimeMs: number): number {
        const outputTime = this.timeMapper.mapSourceToOutputTime(sourceTimeMs);
        if (outputTime === -1) return -1;
        return this.msToX(outputTime);
    }

    /**
     * Convert x pixels to source time (chains through TimeMapper).
     * Returns -1 if outside valid range.
     */
    xToSourceTime(x: number): number {
        const outputTimeMs = this.xToMs(x);
        return this.timeMapper.mapOutputToSourceTime(outputTimeMs);
    }
}
