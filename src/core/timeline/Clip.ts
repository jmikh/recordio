
import type { Clip, TimeMs } from '../types';

/**
 * Functional logic for Clip operations.
 * Pure functions: (state) => newState.
 */
export class ClipImpl {
    /**
     * Creates a new Clip with validation.
     * Ensures sourceIn < sourceOut.
     * 
     * @param sourceId - ID of the source media
     * @param sourceInMs - Start time in source (ms)
     * @param sourceOutMs - End time in source (ms)
     * @param timelineInMs - Start time in timeline (ms)
     * @param options - Optional override for properties like speed, linkGroupId
     */
    static create(
        sourceId: string,
        sourceInMs: TimeMs,
        sourceOutMs: TimeMs,
        timelineInMs: TimeMs,
        options: Partial<Omit<Clip, 'id' | 'sourceId' | 'sourceInMs' | 'sourceOutMs' | 'timelineInMs'>> = {}
    ): Clip {
        if (sourceInMs >= sourceOutMs) {
            throw new Error(`Invalid Clip Duration: sourceIn (${sourceInMs}) >= sourceOut (${sourceOutMs})`);
        }

        return {
            id: crypto.randomUUID(),
            sourceId,
            sourceInMs,
            sourceOutMs,
            timelineInMs,
            speed: 1.0,
            audioVolume: 1.0,
            audioMuted: false,
            ...options
        };
    }

    /**
     * Calculates the duration of the clip on the timeline in milliseconds.
     * Accounts for playback speed.
     * Duration = (SourceOut - SourceIn) / Speed
     */
    static getDuration(clip: Clip): TimeMs {
        return (clip.sourceOutMs - clip.sourceInMs) / clip.speed;
    }

    /**
     * Calculates the end time of the clip on the timeline.
     */
    static getTimelineOut(clip: Clip): TimeMs {
        return clip.timelineInMs + ClipImpl.getDuration(clip);
    }

    /**
     * Splits a clip at a specific TIMELINE time.
     * Returns 2 new clips (Left and Right).
     * The original clip is meant to be replaced by these two.
     * 
     * Throws if split time is outside clip bounds.
     * 
     * @param clip - The clip to split
     * @param splitTimeMs - The point on the timeline to split at
     */
    static split(clip: Clip, splitTimeMs: TimeMs): [Clip, Clip] {
        const start = clip.timelineInMs;
        const end = ClipImpl.getTimelineOut(clip);

        // Allow tolerance for floating point math? Using integer ms for now.
        if (splitTimeMs <= start || splitTimeMs >= end) {
            throw new Error(`Split time ${splitTimeMs} is outside clip bounds [${start}, ${end}]`);
        }

        const offsetMs = (splitTimeMs - start) * clip.speed; // Convert timeline delta to source delta

        const splitSourceTime = clip.sourceInMs + offsetMs;

        // Clip 1: Start to Split
        const left: Clip = {
            ...clip,
            id: crypto.randomUUID(), // New ID
            sourceOutMs: splitSourceTime,
        };

        // Clip 2: Split to End
        const right: Clip = {
            ...clip,
            id: crypto.randomUUID(), // New ID
            sourceInMs: splitSourceTime,
            timelineInMs: splitTimeMs,
        };

        return [left, right];
    }

    /**
     * Checks if a specific timeline time point falls within the clip's duration.
     * Inclusive of start, exclusive of end.
     */
    static containsTime(clip: Clip, timeMs: TimeMs): boolean {
        return timeMs >= clip.timelineInMs && timeMs < ClipImpl.getTimelineOut(clip);
    }
}
