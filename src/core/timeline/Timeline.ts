import type { Timeline, MainTrack, TimeMs, ID, Clip } from '../types';
import { TrackImpl } from './track';
// import { ClipImpl } from './clip'; // Unused

/**
 * Functional logic for Timeline operations.
 * Orchestrates the Main Track.
 */
export class TimelineImpl {
    /**
     * Creates a new Timeline with a default Main Track.
     */
    static create(): Timeline {
        return {
            id: crypto.randomUUID(),
            mainTrack: TrackImpl.createMainTrack(),
            durationMs: 0
        };
    }

    /**
     * Splits clips on the main track at the given time.
     * 
     * @param timeline - The timeline to operate on.
     * @param timeMs - The time at which to split.
     * 
     * @returns A new Timeline instance.
     */
    static splitAt(timeline: Timeline, timeMs: TimeMs): Timeline {
        const track = timeline.mainTrack;

        if (track.locked || !track.visible) return timeline;

        // Check if there is a clip at this time
        const clip = TrackImpl.findClipAtTime(track, timeMs);
        if (!clip) {
            return timeline;
        }

        // Perform split on the main track
        // We cast back to MainTrack because splitAt only affects clips, preserving other props
        const newTrack = TrackImpl.splitAt(track, timeMs) as MainTrack;

        return {
            ...timeline,
            mainTrack: newTrack
        };
    }

    /**
     * Updates a clip on the main track.
     */
    static updateClip(timeline: Timeline, _trackId: ID, updatedClip: Clip): Timeline {
        // We ignore trackId as we only have mainTrack now
        const newTrack = TrackImpl.updateClip(timeline.mainTrack, updatedClip) as MainTrack;

        return {
            ...timeline,
            mainTrack: newTrack
        };
    }
}
