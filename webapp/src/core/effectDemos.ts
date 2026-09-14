/**
 * Effect demos for the Personal Settings preview
 * (plans/user-default-project-settings §3.8).
 *
 * The page has no timeline, so time-based effects (click ring, hotkey
 * pill, auto-zoom, camera auto-shrink, spotlight) are shown on demand: a Preview button asks
 * the canvas to play a short clip built from the CURRENT settings. Clips
 * are ephemeral — nothing here touches the project store, so a demo never
 * dirties the defaults and always reflects the latest slider values.
 */
import type { Project, Rect, SpotlightSegment, ZoomSegment } from '@shared/types';
import {
    EventType,
    type BaseEvent,
    type KeyboardEvent as RecordedKeyboardEvent,
    type UserEvents,
} from '@shared/types/events';
import { ViewMapper } from '@shared/mappers/viewMapper';
import { TimeMapper, recomputeOutputTimes } from '@shared/mappers/timeMapper';
import { getDeviceFrame } from '@shared/utils/deviceFrames';
import { clampViewportToBounds } from '@shared/utils/geometry';
import { EMPTY_USER_EVENTS } from './Project';
import { SAMPLE_CARD_RADIUS_PX, SAMPLE_CARD_RECT, SAMPLE_CLICK_POINT } from './sampleMedia';

/** 'shrink' plays the zoom clip too — the camera animator shrinks the bubble while a zoom is active. */
export type DemoKind = 'click' | 'keyboard' | 'zoom' | 'shrink' | 'spotlight';

export interface DemoClip {
    kind: DemoKind;
    /** Events the painters react to (clicks, keystrokes) — replaces the template's events for the clip. */
    userEvents: UserEvents;
    zoomSegments: ZoomSegment[];
    spotlightSegments: SpotlightSegment[];
    /** Clip length in output ms; the canvas returns to the still afterwards. */
    durationMs: number;
}

/** mouseClickPainter animates a click for this long (CLICK_DURATION). */
const CLICK_PAINT_MS = 500;
/** keyboardPainter shows a keystroke for this long (EVENT_DURATION). */
const KEY_PAINT_MS = 1500;
const LEAD_MS = 300;
const HOLD_MS = 1200;
const TAIL_MS = 200;

function clickAt(timestamp: number): BaseEvent {
    return { type: EventType.CLICK, timestamp, mousePos: { ...SAMPLE_CLICK_POINT } };
}

function keystrokeAt(timestamp: number): RecordedKeyboardEvent {
    return {
        type: EventType.KEYDOWN,
        timestamp,
        mousePos: { ...SAMPLE_CLICK_POINT },
        key: 'k',
        code: 'KeyK',
        metaKey: true,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
    };
}

function makeViewMapper(project: Project): ViewMapper {
    const { screenSource, settings } = project;
    const deviceFrame = settings.screen.mode === 'device'
        ? getDeviceFrame(settings.screen.deviceFrameId)
        : undefined;
    return new ViewMapper(
        screenSource.size,
        settings.outputSize,
        settings.screen.padding,
        settings.screen.crop,
        screenSource.trackableContentRect,
        settings.screen.toolbar.enabled,
        deviceFrame,
    );
}

/** A viewport of outputSize / maxZoom (output px) centred on the sample click, kept in frame. */
export function demoZoomViewport(project: Project): Rect {
    const { outputSize, zoom } = project.settings;
    const full: Rect = { x: 0, y: 0, width: outputSize.width, height: outputSize.height };
    const center = makeViewMapper(project).projectEventPointToOutput(SAMPLE_CLICK_POINT, full);
    const maxZoom = Math.max(1, zoom.maxZoom);
    const width = outputSize.width / maxZoom;
    const height = outputSize.height / maxZoom;
    return clampViewportToBounds(
        { x: center.x - width / 2, y: center.y - height / 2, width, height },
        outputSize,
    );
}

function withEvents(partial: Partial<UserEvents>): UserEvents {
    return { ...EMPTY_USER_EVENTS, ...partial };
}

/**
 * Builds the clip for one effect from the project's current settings.
 * Timings are in source ms; the template's single 1× window makes output
 * time identical, but segments are still stamped through the TimeMapper
 * (the painters read cached output times).
 */
export function buildEffectDemo(kind: DemoKind, project: Project): DemoClip {
    const timeMapper = new TimeMapper(project.timeline.outputWindows);
    const base = { kind, userEvents: withEvents({}), zoomSegments: [] as ZoomSegment[], spotlightSegments: [] as SpotlightSegment[] };

    switch (kind) {
        case 'click':
            return {
                ...base,
                userEvents: withEvents({ mouseClicks: [clickAt(100)] }),
                durationMs: 100 + CLICK_PAINT_MS + TAIL_MS,
            };

        case 'keyboard':
            return {
                ...base,
                userEvents: withEvents({ keyboardEvents: [keystrokeAt(100)] }),
                durationMs: 100 + KEY_PAINT_MS + 100,
            };

        case 'zoom':
        case 'shrink': {
            const { transitionDurationMs: T, easing } = project.settings.zoom;
            const segment: ZoomSegment = {
                id: 'demo-zoom',
                sourceStartTimeMs: LEAD_MS,
                sourceEndTimeMs: LEAD_MS + T + HOLD_MS,
                outputStartTimeMs: 0,
                outputEndTimeMs: 0,
                visible: false,
                rectPx: demoZoomViewport(project),
                reason: 'demo',
                type: 'auto',
                transitionDurationMs: T,
                easing,
            };
            return {
                ...base,
                // the click that would have triggered the zoom, as a visual cue
                userEvents: withEvents({ mouseClicks: [clickAt(LEAD_MS)] }),
                zoomSegments: recomputeOutputTimes([segment], timeMapper),
                // zoom in (T) → hold → gap zoom-out (T) → settle
                durationMs: LEAD_MS + T + HOLD_MS + T + TAIL_MS,
            };
        }

        case 'spotlight': {
            const { transitionDurationMs: T, easing, dimOpacity, enlargeScale } = project.settings.spotlight;
            const segment: SpotlightSegment = {
                id: 'demo-spotlight',
                sourceStartTimeMs: LEAD_MS,
                // the animator fades in over T at the start and out over T before the end
                sourceEndTimeMs: LEAD_MS + T + HOLD_MS + T,
                outputStartTimeMs: 0,
                outputEndTimeMs: 0,
                visible: false,
                sourceRect: { ...SAMPLE_CARD_RECT },
                borderRadiusPx: [SAMPLE_CARD_RADIUS_PX, SAMPLE_CARD_RADIUS_PX, SAMPLE_CARD_RADIUS_PX, SAMPLE_CARD_RADIUS_PX],
                scale: enlargeScale,
                reason: 'demo',
                dimOpacity,
                transitionDurationMs: T,
                easing,
            };
            return {
                ...base,
                spotlightSegments: recomputeOutputTimes([segment], timeMapper),
                durationMs: LEAD_MS + T + HOLD_MS + T + TAIL_MS,
            };
        }
    }
}
