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
            settings: {
                outputSize: { width: 3840, height: 2160 },
                frameRate: 30,
                padding: 0.05,
                maxZoom: 1.5,
                autoZoom: true,
                backgroundType: 'image',
                backgroundImageUrl: '/assets/backgrounds/abstract-gradient.jpg',
                backgroundColor: '#1E1E1E', // Dark Grey
                cornerRadius: 20,

                backgroundBlur: 8,
                camera: {
                    width: 800,
                    height: 600,
                    x: 50,
                    y: 2160 - 650,
                    shape: 'rect'
                }
            },
            timeline: {
                id: crypto.randomUUID(),
                durationMs: 0,
                // We start with NO recording. 
                // The user must create one via 'createFromSource' or potentially 'add empty'
                // For now, let's assume a project must have a recording eventually.
                // We'll init with empty values that need to be populated.
                recording: {
                    timelineOffsetMs: 0,
                    screenSourceId: '',
                    viewportMotions: []
                },
                outputWindows: []
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
            ...project.timeline,
            recording: recording,
            durationMs: durationMs,
            // Create a default output window covering the whole duration
            outputWindows: outputWindows
        };

        return {
            ...project,
            createdAt: new Date(),
            timeline: updatedTimeline
        };
    }

    /**
     * Helper to extract all Source IDs referenced by the project.
     * This replaces the explicit 'sourceIds' list.
     */
    static getReferencedSourceIds(project: Project): ID[] {
        const ids: Set<ID> = new Set();

        // 1. Timeline Sources
        if (project.timeline.recording.screenSourceId) {
            ids.add(project.timeline.recording.screenSourceId);
        }
        if (project.timeline.recording.cameraSourceId) {
            ids.add(project.timeline.recording.cameraSourceId);
        }

        // 2. Settings Sources (e.g. Background)
        if (project.settings.backgroundSourceId) {
            ids.add(project.settings.backgroundSourceId);
        }

        return Array.from(ids);
    }
}
