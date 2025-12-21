import type { Track, MainTrack, Clip, TimeMs } from '../types';
import { ClipImpl } from './clip';

/**
 * Functional logic for Track operations.
 * Manage clips within a single track channel.
 */
export class TrackImpl {
    /**
     * Creates a new generic Track.
     */
    static create(name: string, type: Track['type'] = 'video'): Track {
        return {
            id: crypto.randomUUID(),
            type,
            name,
            clips: [],
            muted: false,
            locked: false,
            visible: true
        };
    }

    /**
     * Creates a new Main Track with effects and display settings.
     */
    static createMainTrack(name: string = "Main Track"): MainTrack {
        return {
            ...TrackImpl.create(name, 'video'),
            // Explicitly cast type if needed, but 'video' is compatible
            // MainTrack specific:
            viewportMotions: [],
            mouseEffects: [],
            displaySettings: {
                mode: 'fullscreen',
                maxZoom: 2.0,
                backgroundColor: '#000000',
                padding: 0
            }
        } as MainTrack;
    }

    /**
     * Adds a clip to the track, maintaining sorted order (by timelineIn).
     * Enforces NO OVERLAPS rule. Use `checkOverlap` to verify before calling if needed,
     * though this method internally validates as well.
     * 
     * @returns A new Track instance with the clip added.
     * @throws Error if the new clip overlaps with any existing clip.
     */
    static addClip(track: Track, clip: Clip): Track {
        console.log("adding a clip")
        // Simple O(N) check for now. Can optimize with binary search later.
        const newTrack = { ...track, clips: [...track.clips] };

        // Validate overlap against all existing clips
        for (const existing of track.clips) {
            if (TrackImpl.checkOverlap(existing, clip)) {
                throw new Error(`Clip overlaps with existing clip ${existing.id}`);
            }
        }

        // Add and Sort
        newTrack.clips.push(clip);
        newTrack.clips.sort((a, b) => a.timelineInMs - b.timelineInMs);

        return newTrack;
    }

    /**
     * Checks if two clips overlap in time.
     * @private
     */
    private static checkOverlap(a: Clip, b: Clip): boolean {
        const aStart = a.timelineInMs;
        const aEnd = ClipImpl.getTimelineOut(a);

        const bStart = b.timelineInMs;
        const bEnd = ClipImpl.getTimelineOut(b);

        return (aStart < bEnd) && (bStart < aEnd);
    }

    /**
     * Finds a clip at a specific timeline time.
     * @returns The clip if found, or null.
     */
    static findClipAtTime(track: Track, timeMs: TimeMs): Clip | null {
        // Linear search is fine for small N
        return track.clips.find(clip => ClipImpl.containsTime(clip, timeMs)) || null;
    }

    /**
     * Splits a clip in the track at the given time.
     * Finds the clip under the playhead, splits it, and replaces it with two new segments.
     * 
     * @returns A new Track instance with the split clips. Returns original track if no clip found at time.
     */
    static splitAt(track: Track, timeMs: TimeMs): Track {
        const targetClip = TrackImpl.findClipAtTime(track, timeMs);
        if (!targetClip) {
            return track; // Nothing to split
        }

        // Perform split
        const [left, right] = ClipImpl.split(targetClip, timeMs);

        // Replace targetClip with left and right
        const newClips = track.clips.filter(c => c.id !== targetClip.id);
        newClips.push(left, right);
        newClips.sort((a, b) => a.timelineInMs - b.timelineInMs);

        return {
            ...track,
            clips: newClips
        };
    }
    /**
     * Updates a clip in the track.
     * Replaces the clip with the same ID.
     * Validates overlaps.
     */
    static updateClip(track: Track, updatedClip: Clip): Track {
        // Remove existing clip
        const filteredClips = track.clips.filter(c => c.id !== updatedClip.id);

        // Re-use addClip logic to validate and insert
        // Temporarily create track state without the old clip
        const tempTrack = { ...track, clips: filteredClips };

        try {
            return TrackImpl.addClip(tempTrack, updatedClip);
        } catch (e) {
            // If overlap fails, we might want to return original track or throw?
            // Throwing allows UI to reject the drop.
            throw e;
        }
    }
}
