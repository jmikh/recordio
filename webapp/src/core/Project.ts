import { type Project, type ScreenMetadata, type CameraMetadata, type MicrophoneMetadata, type UserEvents, type ID, type Size, type Rect, type ProjectSettings, type Timeline } from '../types';
import { calculateAutoZooms, ViewMapper, getAllFocusAreas } from './zoom';
import { TimeMapper } from './mappers/timeMapper';
import { calculateAutoSpotlights } from './spotlight/autoSpotlight';
import { getDeviceFrame } from './deviceFrames';
import { scaleProject } from '@shared/utils/projectScale';
import { CDN_ORIGIN } from '@shared/types/bridge';

export const CURRENT_SCHEMA_VERSION = 5;

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
    storagePath: '',
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
        imageUrl: `${CDN_ORIGIN}/backgrounds/bg10.avif`
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
    static create(): Project {
        return {
            id: crypto.randomUUID(),
            schemaVersion: CURRENT_SCHEMA_VERSION,
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
        microphoneSource?: MicrophoneMetadata
    ): Project {
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
            screenSource,
            cameraSource,
            microphoneSource,
            userEvents,
            settings,
            timeline
        };
    }

    /**
     * Scales a project's spatial settings to match a new output size.
     * Delegates to shared/utils/projectScale.ts.
     */
    static scale(project: Project, newSize: Size): Project {
        return scaleProject(project, newSize);
    }
}
