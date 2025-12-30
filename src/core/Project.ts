import { type Project, type SourceMetadata, type UserEvents, type Recording, type ID } from './types';
import { calculateZoomSchedule, ViewMapper } from './viewportMotion';
import { TimeMapper } from './timeMapper';

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
            timeline: {
                id: crypto.randomUUID(),
                durationMs: 0,
                outputWindows: [],
                recording: {
                    timelineOffsetMs: 0,
                    screenSourceId: '',
                    viewportMotions: []
                }
            },
            settings: {
                outputSize: { width: 3840, height: 2160 },
                frameRate: 30,
                maxZoom: 1.8,
                autoZoom: true,
                backgroundType: 'solid',
                backgroundColor: '#1e1e1e',
                padding: 0.02
            }
        };
    }

    /**
     * Creates a new Project initialized from specific sources.
     * Takes a mandatory screen source and an optional camera source.
     * 
     * NOTE: This assumes the UserEvents are already saved externally and referenced by the SourceMetadata.
     * We do NOT copy events into the project anymore.
     * However, for ViewportMotion calculation (auto-zoom), we NEED the events.
     * So we pass them in as arguments just for calculation (not storage).
     */
    static createFromSource(
        projectId: ID,
        screenSource: SourceMetadata,
        screenEvents: UserEvents, // Required for calculating zooms
        cameraSource?: SourceMetadata
    ): Project {
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

        // Default Output Window
        const outputWindows = [{
            id: crypto.randomUUID(),
            startMs: 0,
            endMs: durationMs
        }];

        // Calculate Zoom Schedule
        // We need a ViewMapper instance
        const viewMapper = new ViewMapper(
            screenSource.size,
            project.settings.outputSize,
            project.settings.padding || 0.03
        );

        const timeMapper = new TimeMapper(0, outputWindows);

        const viewportMotions = calculateZoomSchedule(
            project.settings.maxZoom,
            viewMapper,
            screenEvents,
            timeMapper
        );

        const recording: Recording = {
            timelineOffsetMs: 0,
            screenSourceId: screenSource.id,
            cameraSourceId: cameraSource?.id,
            viewportMotions: viewportMotions
        };

        // Update timeline with this recording
        const updatedTimeline = {
            ...projectWithSource.timeline,
            recording: recording,
            durationMs: durationMs,
            // Create a default output window covering the whole duration
            outputWindows: outputWindows
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
    static addSource(project: Project, source: SourceMetadata): Project {
        return {
            ...project,
            sources: {
                ...project.sources,
                [source.id]: source
            }
        };
    }
}
