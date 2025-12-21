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
     * Splits clips on ALL tracks at the given time.
     * 
     * @param timeline - The timeline to operate on.
     * @param timeMs - The time at which to split.
     * 
     * @returns A new Timeline instance.
     */
    static splitAt(timeline: Timeline, timeMs: TimeMs): Timeline {
        const updates: Partial<Timeline> = {};

        // 1. Split Main Track
        if (!timeline.mainTrack.locked && timeline.mainTrack.visible) {
            const clip = TrackImpl.findClipAtTime(timeline.mainTrack, timeMs);
            if (clip) {
                updates.mainTrack = TrackImpl.splitAt(timeline.mainTrack, timeMs) as MainTrack;
            }
        }

        // 2. Split Overlay Track
        if (timeline.overlayTrack && !timeline.overlayTrack.locked && timeline.overlayTrack.visible) {
            const clip = TrackImpl.findClipAtTime(timeline.overlayTrack, timeMs);
            if (clip) {
                updates.overlayTrack = TrackImpl.splitAt(timeline.overlayTrack, timeMs);
            }
        }

        return {
            ...timeline,
            ...updates
        };
    }

    /**
     * Updates a clip on the specified track.
     */
    static updateClip(timeline: Timeline, trackId: ID, updatedClip: Clip): Timeline {
        if (trackId === timeline.mainTrack.id) {
            const newTrack = TrackImpl.updateClip(timeline.mainTrack, updatedClip) as MainTrack;
            return { ...timeline, mainTrack: newTrack };
        }

        if (timeline.overlayTrack && trackId === timeline.overlayTrack.id) {
            const newTrack = TrackImpl.updateClip(timeline.overlayTrack, updatedClip);
            return { ...timeline, overlayTrack: newTrack };
        }

        return timeline;
    }
}
