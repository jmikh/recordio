
import type { Timeline, Track, TimeMs, ID, Clip } from '../types';
import { TrackImpl } from './Track';
import { ClipImpl } from './Clip';

/**
 * Functional logic for Timeline operations.
 * Orchestrates multiple Tracks.
 */
export class TimelineImpl {
    /**
     * Creates a new empty Timeline.
     */
    static create(): Timeline {
        return {
            id: crypto.randomUUID(),
            tracks: [],
            durationMs: 0
        };
    }

    /**
     * Adds a track to the timeline.
     */
    static addTrack(timeline: Timeline, track: Track): Timeline {
        return {
            ...timeline,
            tracks: [...timeline.tracks, track]
        };
    }

    /**
     * The Master Split Function.
     * Splits tracks at the given time.
     * 
     * HONORS LINK GROUPS:
     * If a clip on Track A is hit, and it has a linkGroupId, 
     * we must ALSO split any other clips with that same groupId on other tracks.
     * 
     * @param timeline - The timeline to operate on.
     * @param timeMs - The time at which to split.
     * @param targetTrackId - Optional. 
     *      If provided, ONLY this track (and its linked peers) will be split.
     *      If omitted, ALL tracks with clips under the playhead will be split ("Razor All").
     * 
     * @returns A new Timeline instance.
     */
    static splitAt(timeline: Timeline, timeMs: TimeMs, targetTrackId?: ID): Timeline {
        // 1. Identify valid hits
        const directHits: { trackId: ID; clip: Clip }[] = [];

        for (const track of timeline.tracks) {
            if (track.locked || !track.visible) continue;

            // If targeting a specific track, skip others
            if (targetTrackId && track.id !== targetTrackId) continue;

            const clip = TrackImpl.findClipAtTime(track, timeMs);
            if (clip) {
                directHits.push({ trackId: track.id, clip });
            }
        }

        if (directHits.length === 0) {
            return timeline;
        }

        // 2. Identify Linked Clips that also need splitting
        // We ALWAYS respect linkage, whether it's a "Razor All" or "Selected Split".
        const clipsToSplit = new Set<{ trackId: ID; clip: Clip }>(); // Uses object ref equality

        // Use a set of IDs to prevent duplicate objects if refs are unstable (though logic below works generally)
        const clipsToSplitIds = new Set<string>();

        const addHit = (hit: { trackId: ID; clip: Clip }) => {
            if (!clipsToSplitIds.has(hit.clip.id)) {
                clipsToSplitIds.add(hit.clip.id);
                clipsToSplit.add(hit);
            }
        };

        // Add proper hits
        directHits.forEach(addHit);

        // Expand for Link Groups
        directHits.forEach(hit => {
            const groupId = hit.clip.linkGroupId;
            if (groupId) {
                // Find all other clips in this group across ALL tracks
                for (const track of timeline.tracks) {
                    if (track.locked) continue;

                    const linkedClips = track.clips.filter(c => c.linkGroupId === groupId);
                    for (const linkedClip of linkedClips) {
                        if (ClipImpl.containsTime(linkedClip, timeMs)) {
                            addHit({ trackId: track.id, clip: linkedClip });
                        }
                    }
                }
            }
        });

        // 3. Execute Splits
        const newTracks = timeline.tracks.map(track => {
            // Check if this track has any clips in the split list
            // Optimization: Filter the set for this trackId
            const hasSplitTarget = Array.from(clipsToSplit).some(item => item.trackId === track.id);

            if (hasSplitTarget) {
                return TrackImpl.splitAt(track, timeMs);
            }

            return track;
        });

        return {
            ...timeline,
            tracks: newTracks
        };
    }
    /**
     * Updates a clip on a specific track.
     */
    static updateClip(timeline: Timeline, trackId: ID, updatedClip: Clip): Timeline {
        const newTracks = timeline.tracks.map(track => {
            if (track.id === trackId) {
                return TrackImpl.updateClip(track, updatedClip);
            }
            return track;
        });

        return {
            ...timeline,
            tracks: newTracks
        };
    }
}
