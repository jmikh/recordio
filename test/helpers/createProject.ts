import type { Project } from '../../shared/types/project';
import type { OutputWindow } from '../../shared/types/timeline';

let idCounter = 0;

export function createId(): string {
    return `test-id-${++idCounter}`;
}

export function resetIds(): void {
    idCounter = 0;
}

export function createOutputWindow(overrides?: Partial<OutputWindow>): OutputWindow {
    return {
        id: createId(),
        startMs: 0,
        endMs: 10000,
        speed: 1,
        ...overrides,
    };
}

export function createTestProject(overrides?: Partial<Project>): Project {
    return {
        id: createId(),
        schemaVersion: 5,
        screenSource: {
            storagePath: 'test-user/test-project/screen.webm',
            durationMs: 10000,
            size: { width: 1920, height: 1080 },
            hasAudio: true,
        },
        userEvents: {
            mouseClicks: [],
            mousePositions: [],
            keyboardEvents: [],
            drags: [],
            scrolls: [],
            typingEvents: [],
            urlChanges: [],
            hoveredCards: [],
        },
        settings: {
            outputSize: { width: 1920, height: 1080 },
            frameRate: 30,
            backgroundType: 'gradient',
            backgroundGradient: { colorA: '#1a1a2e', colorB: '#16213e', angle: 135 },
            backgroundImageUrl: undefined,
            backgroundPaddingPx: 64,
            borderRadiusPx: 12,
            shadowIntensity: 0.5,
            cameraEnabled: false,
            cameraShape: 'circle',
            cameraSizePx: 200,
            cameraPosition: 'bottom-right',
            cameraBorderEnabled: false,
            cameraBorderColorHex: '#ffffff',
            cameraBorderWidthPx: 3,
            cameraMove: { position: 'bottom-right', sizePx: 200 },
            captionsEnabled: false,
            captionPosition: 'bottom',
            captionFontFamily: 'Inter',
            captionSize: 1.0,
            captionStyle: 'classic',
            captionColorHex: '#ffffff',
            captionHighlightColorHex: '#facc15',
            captionBackgroundEnabled: true,
            captionBackgroundColorHex: '#000000',
            captionBackgroundOpacity: 0.6,
            mouseClickEffectEnabled: true,
            mouseClickEffectStyle: 'ripple',
            keyboardEnabled: false,
            zoomEasing: 'ease-out' as const,
            zoomTransitionMs: 500,
            spotlightEasing: 'ease-out' as const,
            spotlightTransitionMs: 400,
            spotlightDimOpacity: 0.3,
            spotlightEnlargeScale: 1.5,
            deviceFrameEnabled: false,
            deviceFrameId: 'macbook-air-dark',
            cursorEnabled: true,
            cursorSizeMultiplier: 1.0,
            backgroundMusicEnabled: false,
            backgroundMusicPresetId: undefined,
            backgroundMusicVolume: 0.3,
            backgroundMusicAssetId: undefined,
        } as Project['settings'],
        timeline: {
            id: createId(),
            durationMs: 10000,
            outputWindows: [{ id: createId(), startMs: 0, endMs: 10000, speed: 1 }],
            zoomSegments: [],
            spotlightSegments: [],
            captionSegments: [],
            cameraMoveSegments: [],
            overlaySegments: [],
            focusAreas: [],
            displaySettings: {
                showZoom: true,
                showSpotlight: true,
                showCameraMove: true,
                showOverlays: true,
            },
        } as Project['timeline'],
        ...overrides,
    };
}
