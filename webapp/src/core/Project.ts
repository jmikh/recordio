import { type Project, type ScreenMetadata, type CameraMetadata, type MicrophoneMetadata, type UserEvents, type ID, type Size, type Rect, type ZoomSegment, type SpotlightSegment, type CameraMoveSegment, type CameraSettings, type ScreenSettings, type ProjectSettings, type Timeline } from '../types';
import type { OverlaySegment } from '../types/overlay';
import { calculateAutoZooms, ViewMapper, getAllFocusAreas } from './zoom';
import { TimeMapper } from './mappers/timeMapper';
import { calculateAutoSpotlights } from './spotlight/autoSpotlight';
import { getDeviceFrame } from './deviceFrames';

export const CURRENT_SCHEMA_VERSION = 4;

// Default display settings for tracks — single source of truth
const DEFAULT_DISPLAY_SETTINGS = {
    showZoom: true,
    showSpotlight: true,
    showCaptions: false,
    showCameraMove: false,
    showOverlay: true,
    collapsed: false,
};

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
};

// Create a placeholder source for empty projects
const createPlaceholderSource = (): ScreenMetadata => ({
    id: '',
    storageUrl: '',
    durationMs: 0,
    size: { width: 1920, height: 1080 },
    hasAudio: false,
});

/**
 * Default settings factory
 */
const createDefaultSettings = (): ProjectSettings => ({
    outputSize: { width: 1920, height: 1080 },
    frameRate: 60,

    zoom: {
        enabled: true,
        maxZoom: 2,
        transitionDurationMs: 750,
        easing: 'ease-in-out'
    },

    spotlight: {
        enabled: true,
        dimOpacity: 0.5,
        enlargeScale: 1.25,
        transitionDurationMs: 750,
        minHoldDurationMs: 200,
        defaultHoldDurationMs: 1000,
        easing: 'ease-in-out'
    },

    mouse: {
        mouseClickEnabled: true,
        mouseDragEnabled: true,
        effectType: 'ring',
        color: '#8b5cf6',
        size: 1.0,
        soundEnabled: false,
        soundVolume: 0.5,
    },

    keyboard: {
        showHotkeys: true,
        hotkeysSize: 1.0,
        hotkeysPlacement: 'top',
        hotkeysMargin: 4,
    },

    screen: {
        mode: 'border',
        toolbar: {
            enabled: true,
            theme: 'light',
            urlMode: 'short',
        },
        padding: 0.02,
        borderRadiusPx: 12,
        borderWidthPx: 1,
        borderColor: '#667eea',
        deviceFrameId: 'macbook-air-dark',
        hasShadow: true,
        hasGlow: false,
        hasFeather: false,
        mute: false
    },

    background: {
        type: 'preset',
        color: '#6078c4ff',
        gradientColors: ['#95a6f2ff', '#83689dff'],
        gradientDirection: 135,
        colorMode: 'gradient',
        backgroundBlurPx: 0,
        imageUrl: 'https://cdn.recordio.cc/backgrounds/bg10.avif'
    },

    captions: {
        enabled: true,
        captionSize: 1.0,
        width: 75,
        textColor: '#ffffff',
        backgroundColor: '#000000cc',
        wordHighlight: true,
    },

    audio: {
        muteMicrophone: false,
        muteScreenAudio: false,
        screenVolume: 1,
        microphoneVolume: 1,
        music: {
            enabled: false,
            source: 'preset',
            volume: 0.3,
            fadeOutDurationMs: 3000,
        },
    },

    camera: {
        widthPx: 300,
        heightPx: 300,
        xPx: 25,
        yPx: 1080 - 325,
        shape: 'circle',
        borderRadiusPx: 0,
        borderWidthPx: 0,
        borderColor: 'white',
        hasShadow: true,
        hasGlow: false,
        hasFeather: false,
        cropZoom: 1,
        autoShrink: true,
        shrinkScale: 0.5,
        mirrored: false,
        featherAmount: 0.15,
    },

    cameraMove: {
        enabled: true,
        transitionDurationMs: 500,
        easing: 'ease-in-out'
    },

    overlay: {
        enabled: true,
        defaultDurationMs: 3000,
        blurDefaults: { blurRadiusPx: 20 },
        textDefaults: { color: '#454545', backgroundColor: '#ffdb57', fontSizePx: 0 },
        arrowDefaults: { color: '#7B61FF', strokeWidthPx: 4 },
        borderDefaults: { color: '#7B61FF', borderWidthPx: 4 },
    },

    autoCutApplied: false,
});

/**
 * Default timeline factory
 */
const createDefaultTimeline = (): Timeline => ({
    id: crypto.randomUUID(),
    durationMs: 0,
    zoomSegments: [],
    spotlightSegments: [],
    cameraMoveSegments: [],
    overlaySegments: [],
    outputWindows: [],
    focusAreas: [],
    captionSegments: [],
    displaySettings: { ...DEFAULT_DISPLAY_SETTINGS },
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
            schemaVersion: CURRENT_SCHEMA_VERSION,
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
        screenSource: ScreenMetadata,
        userEvents: UserEvents,
        cameraSource?: CameraMetadata,
        rawName?: string,
        microphoneSource?: MicrophoneMetadata
    ): Project {
        let name = rawName || "New Project";
        if (name.length > 40) {
            name = name.substring(0, 37) + "...";
        }

        const settings = createDefaultSettings();

        // Detect if user events were captured (Chrome tab/window vs desktop)
        const hasUserEvents = userEvents.mousePositions.length > 0;

        // Use Screen Recording Duration as the Project Duration
        const durationMs = screenSource.durationMs;

        const outputWindows = [{
            id: crypto.randomUUID(),
            startMs: 0,
            endMs: durationMs,
            speed: 1,
        }];

        // Calculate Zoom Schedule
        const deviceFrame = settings.screen.mode === 'device'
            ? getDeviceFrame(settings.screen.deviceFrameId)
            : undefined;

        const viewMapper = new ViewMapper(
            screenSource.size,
            settings.outputSize,
            settings.screen.padding,
            undefined,
            screenSource.trackableContentRect,
            settings.screen.toolbar.enabled,
            deviceFrame
        );

        const timeMapper = new TimeMapper(outputWindows);
        const focusAreas = getAllFocusAreas(userEvents, screenSource.size, screenSource.durationMs);
        const zoomSegments = hasUserEvents
            ? calculateAutoZooms(
                settings.zoom,
                viewMapper,
                timeMapper,
                focusAreas
            )
            : [];

        // Calculate Spotlight Schedule (if has events)
        const spotlightSegments = hasUserEvents
            ? calculateAutoSpotlights(
                viewMapper,
                timeMapper,
                userEvents.hoveredCards || [],
                zoomSegments,
                settings.zoom,
                settings.spotlight
            )
            : [];

        const timeline: Timeline = {
            id: crypto.randomUUID(),
            durationMs: durationMs,
            outputWindows: outputWindows,
            zoomSegments: zoomSegments,
            spotlightSegments: spotlightSegments,
            focusAreas: focusAreas,
            captionSegments: [],
            cameraMoveSegments: [],
            overlaySegments: [],
            displaySettings: { ...DEFAULT_DISPLAY_SETTINGS },
        };

        return {
            id: projectId,
            schemaVersion: CURRENT_SCHEMA_VERSION,
            name,
            createdAt: new Date(),
            updatedAt: new Date(),
            screenSource,
            cameraSource,
            microphoneSource,
            userEvents,
            settings,
            timeline
        };
    }

    /**
     * Recursively scales any number property ending in 'Px' by the given scale factor.
     * Also handles Rect objects (only if parent field ends in Px) and arrays.
     */
    private static scalePixelValues(obj: any, scale: number, parentKey: string = ''): any {
        if (obj === null || obj === undefined) return obj;

        // Handle arrays (e.g. spotlight borderRadiusPx: [number, number, number, number])
        if (Array.isArray(obj)) {
            // Only scale array elements if parent key ends with Px
            if (parentKey.endsWith('Px')) {
                return obj.map(item => {
                    if (typeof item === 'number') return item * scale;
                    if (typeof item === 'object') return ProjectImpl.scalePixelValues(item, scale, parentKey);
                    return item;
                });
            }
            // Otherwise recurse without scaling
            return obj.map(item => {
                if (typeof item === 'object') return ProjectImpl.scalePixelValues(item, scale, parentKey);
                return item;
            });
        }

        // Handle Rect objects - ONLY scale if parent field ends with Px
        if (obj.hasOwnProperty('x') && obj.hasOwnProperty('y') && obj.hasOwnProperty('width') && obj.hasOwnProperty('height')) {
            if (parentKey.endsWith('Px')) {
                return {
                    x: obj.x * scale,
                    y: obj.y * scale,
                    width: obj.width * scale,
                    height: obj.height * scale
                };
            }
            // Don't scale source coordinate rects (e.g., ZoomSegment.rect, SpotlightSegment.sourceRect)
            return obj;
        }

        // Handle Point objects ({x, y} without width/height) — overlay output coordinates.
        // Fields like tail, head, topLeft are in output pixels but don't use the Px suffix.
        const POINT_FIELDS_TO_SCALE = ['tail', 'head', 'topLeft'];
        if (obj.hasOwnProperty('x') && obj.hasOwnProperty('y') && !obj.hasOwnProperty('width') && POINT_FIELDS_TO_SCALE.includes(parentKey)) {
            return { x: obj.x * scale, y: obj.y * scale };
        }

        // Not an object — return as-is
        if (typeof obj !== 'object') return obj;

        const result: any = {};
        for (const key in obj) {
            if (!obj.hasOwnProperty(key)) continue;

            const value = obj[key];

            // Scale number fields ending in 'Px'
            if (key.endsWith('Px') && typeof value === 'number') {
                result[key] = value * scale;
            }
            // Recursively process nested objects (pass key for context)
            else if (typeof value === 'object') {
                result[key] = ProjectImpl.scalePixelValues(value, scale, key);
            }
            // Pass through all other values
            else {
                result[key] = value;
            }
        }
        return result;
    }

    /**
     * Scales a project's spatial settings to match a new output size.
     * Used for exporting at different resolutions while maintaining proportions.
     * Automatically scales all fields ending in 'Px' (e.g. borderRadiusPx, widthPx).
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

        return {
            ...project,
            settings: {
                ...ProjectImpl.scalePixelValues(project.settings, scale),
                outputSize: { ...newSize },
            },
            timeline: {
                ...project.timeline,
                // Auto-scale Px-suffixed fields in timeline actions:
                //   ZoomSegment.rectPx (output coords) → scaled
                //   SpotlightSegment.borderRadiusPx → scaled
                //   SpotlightSegment.sourceRect (source coords, no Px suffix) → NOT scaled
                zoomSegments: project.timeline.zoomSegments.map((za: ZoomSegment) =>
                    ProjectImpl.scalePixelValues(za, scale) as ZoomSegment
                ),
                spotlightSegments: project.timeline.spotlightSegments.map((sa: SpotlightSegment) =>
                    ProjectImpl.scalePixelValues(sa, scale) as SpotlightSegment
                ),
                cameraMoveSegments: (project.timeline.cameraMoveSegments || []).map((cl: CameraMoveSegment) =>
                    ProjectImpl.scalePixelValues(cl, scale) as CameraMoveSegment
                ),
                overlaySegments: (project.timeline.overlaySegments || []).map((ob: OverlaySegment) =>
                    ProjectImpl.scalePixelValues(ob, scale) as OverlaySegment
                ),
            }
        };
    }
}
