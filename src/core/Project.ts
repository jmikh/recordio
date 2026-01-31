import { type Project, type SourceMetadata, type UserEvents, type ID, type Size, type Rect, type ZoomAction, type SpotlightAction, type CameraSettings, type ScreenSettings, type ProjectSettings, type Timeline } from './types';
import { calculateZoomSchedule, ViewMapper, getAllFocusAreas } from './zoom';
import { TimeMapper } from './mappers/timeMapper';
import { calculateAutoSpotlights } from './spotlight/spotlightScheduler';

// Empty events constant
const EMPTY_USER_EVENTS: UserEvents = {
    mouseClicks: [],
    mousePositions: [],
    keyboardEvents: [],
    drags: [],
    scrolls: [],
    typingEvents: [],
    urlChanges: [],
    hoveredCards: [],
    allEvents: []
};

// Create a placeholder source for empty projects
const createPlaceholderSource = (): SourceMetadata => ({
    id: '',
    type: 'video',
    storageUrl: '',
    durationMs: 0,
    size: { width: 1920, height: 1080 },
    hasAudio: false,
    has_microphone: false,
    name: ''
});

/**
 * Default settings factory
 */
const createDefaultSettings = (): ProjectSettings => ({
    outputSize: { width: 1920, height: 1080 },
    frameRate: 60,

    zoom: {
        maxZoom: 2,
        isAuto: true,
        maxZoomDurationMs: 750,
        minZoomDurationMs: 200
    },

    spotlight: {
        isAuto: true,
        dimOpacity: 0.5,
        enlargeScale: 1.25,
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
});

/**
 * Default timeline factory
 */
const createDefaultTimeline = (): Timeline => ({
    id: crypto.randomUUID(),
    durationMs: 0,
    zoomActions: [],
    spotlightActions: [],
    outputWindows: [],
    focusAreas: []
});

/**
 * Functional logic for Project operations.
 */
export class ProjectImpl {
    /**
     * Initializes a new Project with default structure.
     * NOTE: This creates a placeholder project that must be populated with createFromSource.
     */
    static create(name: string = "New Project"): Project {
        return {
            id: crypto.randomUUID(),
            name,
            createdAt: new Date(),
            updatedAt: new Date(),
            screenSource: createPlaceholderSource(),
            userEvents: EMPTY_USER_EVENTS,
            settings: createDefaultSettings(),
            timeline: createDefaultTimeline()
        };
    }

    /**
     * Creates a new Project initialized from specific sources.
     * Takes a mandatory screen source, events, and an optional camera source.
     * 
     * Sources and events are embedded directly in the project.
     */
    static createFromSource(
        projectId: ID,
        screenSource: SourceMetadata,
        userEvents: UserEvents,
        cameraSource?: SourceMetadata
    ): Project {
        let name = screenSource.name || "New Project";
        if (name.length > 40) {
            name = name.substring(0, 37) + "...";
        }

        const settings = createDefaultSettings();

        // Use Screen Recording Duration as the Project Duration
        const durationMs = screenSource.durationMs;

        const outputWindows = [{
            id: crypto.randomUUID(),
            startMs: 0,
            endMs: durationMs
        }];

        // Calculate Zoom Schedule
        const viewMapper = new ViewMapper(
            screenSource.size,
            settings.outputSize,
            settings.screen.padding
        );

        const timeMapper = new TimeMapper(outputWindows);
        const focusAreas = getAllFocusAreas(userEvents, timeMapper, screenSource.size);
        const zoomActions = calculateZoomSchedule(
            settings.zoom,
            viewMapper,
            focusAreas
        );

        // Calculate Spotlight Schedule (if auto-spotlights enabled)
        const spotlightActions = settings.spotlight.isAuto
            ? calculateAutoSpotlights(
                viewMapper,
                timeMapper,
                userEvents.hoveredCards || [],
                zoomActions,
                settings.spotlight.enlargeScale
            )
            : [];

        const timeline: Timeline = {
            id: crypto.randomUUID(),
            durationMs: durationMs,
            outputWindows: outputWindows,
            zoomActions: zoomActions,
            spotlightActions: spotlightActions,
            focusAreas: focusAreas
        };

        return {
            id: projectId,
            name,
            createdAt: new Date(),
            updatedAt: new Date(),
            screenSource,
            cameraSource,
            userEvents,
            settings,
            timeline
        };
    }

    /**
     * Scales a project's spatial settings to match a new output size.
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

        const newSpotlightActions: SpotlightAction[] = project.timeline.spotlightActions.map((s: SpotlightAction) => ({
            ...s,
            sourceRect: scaleRect(s.sourceRect),
            borderRadius: [
                s.borderRadius[0] * scale,
                s.borderRadius[1] * scale,
                s.borderRadius[2] * scale,
                s.borderRadius[3] * scale
            ] as [number, number, number, number]
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
                zoomActions: newZoomActions,
                spotlightActions: newSpotlightActions
            }
        };
    }
}
