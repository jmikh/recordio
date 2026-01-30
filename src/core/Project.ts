import { type Project, type SourceMetadata, type UserEvents, type ID, type Size, type Rect, type ZoomAction, type CameraSettings, type ScreenSettings } from './types';
import { calculateZoomSchedule, ViewMapper, getAllFocusAreas } from './zoom';
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
                    isAuto: true,
                    maxZoomDurationMs: 750,
                    minZoomDurationMs: 200
                },

                spotlight: {
                    dimOpacity: 0.5,
                    enlargeScale: 1.1,
                    transitionDurationMs: 300
                },

                effects: {
                    showMouseClicks: true,
                    showMouseDrags: true,
                    showKeyboardClicks: true
                },

                screen: {
                    mode: 'device',
                    padding: 0.1,
                    borderRadius: 16,
                    borderWidth: 2,
                    borderColor: '#667eea',
                    deviceFrameId: 'macbook-air-dark',
                    hasShadow: true,
                    hasGlow: false,
                    mute: false
                },

                background: {
                    type: 'gradient',
                    color: '#6078c4ff',
                    gradientColors: ['#95a6f2ff', '#83689dff'],
                    gradientDirection: 'SE',
                    lastColorMode: 'gradient',
                    backgroundBlur: 0
                },

                captions: {
                    visible: true,
                    size: 50,
                    width: 75
                },

                camera: {
                    width: 300,
                    height: 300,
                    x: 25,
                    y: 1080 - 325,
                    shape: 'circle',
                    borderRadius: 50,
                    borderWidth: 1,
                    borderColor: 'white',
                    hasShadow: true,
                    hasGlow: false,
                    cropZoom: 1,
                    autoShrink: true,
                    shrinkScale: 0.5
                },
            },
            timeline: {
                id: crypto.randomUUID(),
                durationMs: 0,
                // We start with NO recording. 
                // The user must create one via 'createFromSource' or potentially 'add empty'
                // For now, let's assume a project must have a recording eventually.
                // We'll init with empty values that need to be populated.
                screenSourceId: '',
                zoomActions: [],
                spotlights: [],
                outputWindows: [],
                focusAreas: []
            }
        };
    }

    /**
     * Creates a new Project initialized from specific sources.
     * Takes a mandatory screen source and an optional camera source.
     * 
     * NOTE: This assumes the UserEvents are already saved externally and referenced by the SourceMetadata.
     * We do NOT copy events into the project anymore.
     * However, for ZoomAction calculation (auto-zoom), we NEED the events.
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
        const focusAreas = getAllFocusAreas(screenEvents, timeMapper, screenSource.size);
        const zoomActions = calculateZoomSchedule(
            project.settings.zoom,
            viewMapper,
            focusAreas
        );

        // Update timeline with recording properties
        const updatedTimeline = {
            ...project.timeline,
            screenSourceId: screenSource.id,
            cameraSourceId: cameraSource?.id,
            zoomActions: zoomActions,
            durationMs: durationMs,
            // Create a default output window covering the whole duration
            outputWindows: outputWindows,
            // Store computed focus areas for reuse
            focusAreas: focusAreas
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
        if (project.timeline.screenSourceId) {
            ids.add(project.timeline.screenSourceId);
        }
        if (project.timeline.cameraSourceId) {
            ids.add(project.timeline.cameraSourceId);
        }

        // 2. Settings Sources (e.g. Background)
        if (project.settings.background.sourceId) {
            ids.add(project.settings.background.sourceId);
        }

        return Array.from(ids);
    }

    /**
     * Scales a project's spatial settings to match a new output size. All pixel related settings must be scaled. (A better approach might to migrate all settings to use relative units)
     * Used for exporting at different resolutions while maintaining proportions.
     */
    static scale(project: Project, newSize: Size): Project {
        const oldSize = project.settings.outputSize;

        const scaleX = newSize.width / oldSize.width;
        const scaleY = newSize.height / oldSize.height;

        // Verify uniform scaling (export changes quality, not aspect ratio)
        const scaleDiff = Math.abs(scaleX - scaleY);
        const tolerance = 0.001; // 0.1% tolerance
        if (scaleDiff > tolerance) {
            console.error(`Scale factors differ: scaleX=${scaleX}, scaleY=${scaleY}, diff=${scaleDiff}`);
        }

        // Use single scale factor (average of both for robustness)
        const scale = (scaleX + scaleY) / 2;

        const scaleRect = (rect: Rect): Rect => ({
            x: rect.x * scale,
            y: rect.y * scale,
            width: rect.width * scale,
            height: rect.height * scale
        });

        const scaleCamera = (cam: CameraSettings): CameraSettings => ({
            ...cam,
            x: cam.x * scale,
            y: cam.y * scale,
            width: cam.width * scale,
            height: cam.height * scale,
            borderRadius: cam.borderRadius * scale,
            borderWidth: cam.borderWidth * scale,
        });

        const scaleScreen = (screen: ScreenSettings): ScreenSettings => ({
            ...screen,
            borderRadius: screen.borderRadius * scale,
            borderWidth: screen.borderWidth * scale,
        });

        const newZoomActions: ZoomAction[] = project.timeline.zoomActions.map((m: ZoomAction) => ({
            ...m,
            rect: scaleRect(m.rect)
        }));

        return {
            ...project,
            settings: {
                ...project.settings,
                outputSize: { ...newSize },
                camera: project.settings.camera ? scaleCamera(project.settings.camera) : undefined,
                screen: scaleScreen(project.settings.screen),
                captions: {
                    ...project.settings.captions,
                    size: project.settings.captions.size * scale,
                },
                background: {
                    ...project.settings.background,
                    backgroundBlur: project.settings.background.backgroundBlur * scale,
                }
            },
            timeline: {
                ...project.timeline,
                zoomActions: newZoomActions
            }
        };
    }
}
