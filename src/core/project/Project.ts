
import type { Project, ID, TimeMs, Source, Track } from '../types';
import { TimelineImpl } from '../timeline/timeline';
import { TrackImpl } from '../timeline/track';

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
                size: { width: 3840, height: 2160 },
                frameRate: 30
            },
            background: {
                type: 'solid',
                color: '#1e1e1e'
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
     * Updates an existing media source with partial data (e.g. adding duration after load).
     */
    static updateSource(project: Project, sourceId: ID, updates: Partial<Source>): Project {
        const existing = project.sources[sourceId];
        if (!existing) return project;

        return {
            ...project,
            sources: {
                ...project.sources,
                [sourceId]: {
                    ...existing,
                    ...updates
                }
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

        const tracksToCheck: Track[] = [project.timeline.mainTrack];
        if (project.timeline.overlayTrack) tracksToCheck.push(project.timeline.overlayTrack);

        for (const track of tracksToCheck) {
            if (!track.muted && track.visible) {
                // Find clip at time
                const clip = TrackImpl.findClipAtTime(track, timeMs);

                if (clip) {
                    const source = project.sources[clip.sourceId];
                    if (source) {
                        // Calculate Source Time
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
        }

        return result;
    }
}
