
import type { Project, ID, TimeMs, Source } from '../types';
import { TimelineImpl } from '../timeline/Timeline';
import { TrackImpl } from '../timeline/Track';

/**
 * Represents the resolved state of the timeline at a specific point in time.
 * Used by the renderer (PlayerCanvas) to know what frame to draw.
 */
export interface RenderState {
    timeMs: TimeMs;
    /** List of tracks to render, possibly containing a resolved clip frame */
    tracks: {
        trackId: ID;
        clip?: {
            id: ID;
            source: Source;
            /** The specific timestamp within the source media to render */
            sourceTimeMs: TimeMs;
        };
    }[];
}

/**
 * Functional logic for Project operations.
 */
export class ProjectImpl {
    /**
     * Initializes a new Project with default structure.
     */
    static create(name: string = "New Project"): Project {
        return {
            id: crypto.randomUUID(),
            name,
            createdAt: new Date(),
            updatedAt: new Date(),
            sources: {},
            timeline: TimelineImpl.create(),
            outputSettings: {
                width: 1920,
                height: 1080,
                frameRate: 30
            }
        };
    }

    /**
     * Adds a media source to the project library.
     */
    static addSource(project: Project, source: Source): Project {
        return {
            ...project,
            sources: {
                ...project.sources,
                [source.id]: source
            }
        };
    }

    /**
     * Resolves what should be rendered at a specific timeline time.
     * Iterates all visible tracks and calculates the exact Source Time for any active clips.
     * 
     * @param project - The project state
     * @param timeMs - The current playhead time
     * @returns A RenderState object suitable for the UI/Canvas to draw.
     */
    static getRenderState(project: Project, timeMs: TimeMs): RenderState {
        const result: RenderState = {
            timeMs,
            tracks: []
        };

        for (const track of project.timeline.tracks) {
            if (track.muted || !track.visible) continue;

            // Find clip at time
            const clip = TrackImpl.findClipAtTime(track, timeMs);

            if (clip) {
                const source = project.sources[clip.sourceId];
                if (source) {
                    // Calculate Source Time
                    // sourceTime = sourceIn + (timelineTime - timelineIn) * speed
                    const offset = (timeMs - clip.timelineInMs) * clip.speed;
                    const sourceTimeMs = clip.sourceInMs + offset;

                    result.tracks.push({
                        trackId: track.id,
                        clip: {
                            id: clip.id,
                            source,
                            sourceTimeMs
                        }
                    });
                }
            } else {
                result.tracks.push({ trackId: track.id });
            }
        }

        return result;
    }
}
