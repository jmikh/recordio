
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
                color: '#1e1e1e',
                padding: 0.05
            }
        };
    }

    /**
     * Creates a new Project initialized from a recorded Source.
     * Copies the source events into the timeline's recording.
     */
    /**
     * Creates a new Project initialized from specific sources.
     * Takes a mandatory screen source and an optional camera source.
     */
    static createFromSource(projectId: ID, screenSource: Source, cameraSource?: Source): Project {
        const project = this.create("Recording - " + new Date().toLocaleString());
        project.id = projectId; // Override random ID with specific projectId

        // Add Screen Source
        let projectWithSource = this.addSource(project, screenSource);

        // Add Camera Source if present
        if (cameraSource) {
            projectWithSource = this.addSource(projectWithSource, cameraSource);
        }

        // Use Screen Recording Duration as the Project Duration
        const durationMs = screenSource.durationMs;

        // Setup the recording in the timeline
        // We populate the Recording with events from the SCREEN source (primary interaction)

        const recording: Recording = {
            timelineOffsetMs: 0,
            screenSourceId: screenSource.id,
            cameraSourceId: cameraSource?.id,

            // Map UserEvent[] to specific event arrays
            clickEvents: [],
            dragEvents: [],
            keyboardEvents: [],
            viewportMotions: []
        };

        if (screenSource.events) {
            screenSource.events.forEach(e => {
                if (e.type === 'click') recording.clickEvents.push(e as any);
                else if (e.type === 'drag') recording.dragEvents.push(e as any);
                else if (e.type === 'keydown') recording.keyboardEvents.push(e as any);
            });
        }

        // Update timeline with this recording
        const updatedTimeline = {
            ...projectWithSource.timeline,
            recording: recording,
            durationMs: durationMs,
            // Create a default output window covering the whole duration
            outputWindows: [{
                id: crypto.randomUUID(),
                startMs: 0,
                endMs: durationMs
            }]
        };

        return {
            ...projectWithSource,
            createdAt: new Date(),
            timeline: updatedTimeline
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
