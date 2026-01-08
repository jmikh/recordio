import { type Project, type SourceMetadata, type UserEvents, type Recording, type ID, type Size, type Rect, type ViewportMotion, type CameraSettings, type ScreenSettings } from './types';
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
                outputSize: { width: 1920, height: 1080 },
                frameRate: 60,

                zoom: {
                    maxZoom: 2,
                    autoZoom: true,
                    maxZoomDurationMs: 600,
                    minZoomDurationMs: 300
                },

                screen: {
                    mode: 'device',
                    deviceFrameId: 'macbook-pro',
                    borderRadius: 12, // Default if mode switched to border
                    borderWidth: 0,
                    borderColor: 'white',
                    hasShadow: true,
                    hasGlow: false,
                    padding: 0.06
                },

                background: {
                    type: 'gradient',
                    color: '#c7d2fe',
                    gradientColors: ['#c7d2fe', '#3a3991'],
                    gradientDirection: 'SE',
                    backgroundBlur: 0,
                    lastColorMode: 'gradient'
                },

                camera: {
                    width: 300,
                    height: 300,
                    x: 25,
                    y: 1080 - 325,
                    shape: 'circle',
                    borderRadius: 50,
                    borderWidth: 2,
                    borderColor: 'white',
                    hasShadow: false,
                    hasGlow: true,
                    zoom: 1

                },
            },
            timeline: {
                id: crypto.randomUUID(),
                durationMs: 0,
                // We start with NO recording. 
                // The user must create one via 'createFromSource' or potentially 'add empty'
                // For now, let's assume a project must have a recording eventually.
                // We'll init with empty values that need to be populated.
                recording: {
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
        let name = screenSource.name || "New Project";
        if (name.length > 40) {
            name = name.substring(0, 37) + "...";
        }
        const project = this.create(name);
        project.id = projectId; // Override random ID with specific projectId

        // Use Screen Recording Duration as the Project Duration
        const durationMs = screenSource.durationMs;

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
            project.settings.screen.padding
        );

        const timeMapper = new TimeMapper(outputWindows);

        const viewportMotions = calculateZoomSchedule(
            project.settings.zoom,
            viewMapper,
            screenEvents,
            timeMapper
        );

        const recording: Recording = {
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
        if (project.settings.background.sourceId) {
            ids.add(project.settings.background.sourceId);
        }

        return Array.from(ids);
    }

    /**
     * Scales a project's spatial settings to match a new output size.
     * Useful for exporting at different resolutions (360p, 4K, etc.) while maintaining relative positioning and sizing.
     */
    static scale(project: Project, newSize: Size): Project {
        const oldSize = project.settings.outputSize;

        // Calculate scale factors
        const scaleX = newSize.width / oldSize.width;
        const scaleY = newSize.height / oldSize.height;

        // Helper to scale a Rect
        const scaleRect = (rect: Rect): Rect => ({
            x: rect.x * scaleX,
            y: rect.y * scaleY,
            width: rect.width * scaleX,
            height: rect.height * scaleY
        });

        // Helper to scale Camera Settings
        const scaleCamera = (cam: CameraSettings): CameraSettings => ({
            ...cam,
            x: cam.x * scaleX,
            y: cam.y * scaleY,
            width: cam.width * scaleX,
            height: cam.height * scaleY,
            // Uniform scaling for border radius/width? Use average or max?
            // Usually dependent on the smaller dimension or just one.
            // Let's use scaleX (width-based) as primary for borders/radius to keep consistent with width resizing.
            borderRadius: cam.borderRadius * ((scaleX + scaleY) / 2),
            borderWidth: cam.borderWidth * ((scaleX + scaleY) / 2),
            // TODO: Scale shadow and glow width (currently consts or implicitly handled by CSS/Canvas effects?
            // Note: The types say 'hasShadow', 'hasGlow' boolean, but implementation might use fixed values.
            // If they become configurable numbers, scale them here.
        });

        // Helper to scale Screen Settings
        const scaleScreen = (screen: ScreenSettings): ScreenSettings => ({
            ...screen,
            borderWidth: screen.borderWidth * ((scaleX + scaleY) / 2),
        });

        // Scale Viewport Motions
        const newViewportMotions: ViewportMotion[] = project.timeline.recording.viewportMotions.map(m => ({
            ...m,
            rect: scaleRect(m.rect)
        }));

        // Clone and return new Project
        return {
            ...project,
            settings: {
                ...project.settings,
                outputSize: { ...newSize },
                camera: project.settings.camera ? scaleCamera(project.settings.camera) : undefined,
                screen: scaleScreen(project.settings.screen)
            },
            timeline: {
                ...project.timeline,
                recording: {
                    ...project.timeline.recording,
                    viewportMotions: newViewportMotions
                }
            }
        };
    }
}
