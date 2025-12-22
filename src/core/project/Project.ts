
import type { Project, ID, TimeMs, Source, Recording } from '../types';
import { TimelineImpl } from '../timeline/Timeline';
import { mapTimelineToOutputTime } from '../effects/timeMapper';

/**
 * Represents the resolved state of the timeline at a specific point in time.
 * Used by the renderer (PlayerCanvas) to know what frame to draw.
 */
export interface RenderState {
    timeMs: TimeMs;
    /** Whether the current time falls within an output window */
    isActive: boolean;

    /** The calculated output time (gapless video time) */
    outputTimeMs: TimeMs;

    /** The calculated source time */
    sourceTimeMs: TimeMs;

    /** The recording to render */
    recording: Recording;

    /** Resolved Source objects */
    screenSource?: Source;
    cameraSource?: Source; // Future proofing
}

/**
 * Functional logic for Project operations.
 */
export class ProjectImpl {
    /**
     * Initializes a new Project with default structure.
     */
    static create(name: string = "New Project"): Project {
        // Need a placeholder source ID or empty
        return {
            id: crypto.randomUUID(),
            name,
            createdAt: new Date(),
            updatedAt: new Date(),
            sources: {},
            timeline: TimelineImpl.create(''),
            outputSettings: {
                size: { width: 3840, height: 2160 },
                frameRate: 30
            },
            zoom: {
                maxZoom: 2.0,
                auto: true
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
     */
    static getRenderState(project: Project, timeMs: TimeMs): RenderState {
        const { timeline, sources } = project;
        const { recording, outputWindows } = timeline;

        // 1. Check if time is in any output window
        // Windows are ordered and non-overlapping.
        // We can optimize search, but linear is fine for now.
        const activeWindow = outputWindows.find(w => timeMs >= w.startMs && timeMs < w.endMs);
        const isActive = !!activeWindow;

        // 2. Calculate Source Time
        // Source Time = Timeline Time - Recording Offset (Source 0 is at offset)
        const sourceTimeMs = timeMs - recording.timelineOffsetMs;

        // 3. Calculate Output Time (for effects)
        const outputTimeMs = mapTimelineToOutputTime(timeMs, outputWindows);

        // 4. Resolve Sources
        const screenSource = sources[recording.screenSourceId];
        const cameraSource = recording.cameraSourceId ? sources[recording.cameraSourceId] : undefined;

        return {
            timeMs,
            isActive,
            outputTimeMs,
            sourceTimeMs,
            recording,
            screenSource,
            cameraSource
        };
    }
}
