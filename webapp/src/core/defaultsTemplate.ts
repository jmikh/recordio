/**
 * The "defaults template" — a synthetic project the Personal Settings page
 * loads into the global project store so the editor's own settings panels
 * can edit the user's defaults, and the preview can render them on a
 * sample recording (plans/user-default-project-settings §3.5).
 *
 * The still frame is clean: at STILL_TIME_MS nothing time-based is
 * active. Clicks, keystrokes, zooms and spotlights are shown by the
 * effect demos (effectDemos.ts), never baked into the template.
 */
import type { CaptionSegment, Project, ProjectSettings, Word } from '@shared/types';
import { EventType, type UserEvents } from '@shared/types/events';
import { TimeMapper, recomputeOutputTimes } from '@shared/mappers/timeMapper';
import { CURRENT_SCHEMA_VERSION, DEFAULT_DISPLAY_SETTINGS, EMPTY_USER_EVENTS } from './Project';
import {
    SAMPLE_CAMERA_PATH,
    SAMPLE_CAMERA_SIZE,
    SAMPLE_MIC_PATH,
    SAMPLE_SCREEN_PATH,
    SAMPLE_SCREEN_SIZE,
} from './sampleMedia';

export const DEFAULTS_TEMPLATE_ID = 'defaults-template';
export const TEMPLATE_DURATION_MS = 10_000;
/** Output time of the still frame. */
export const STILL_TIME_MS = 0;

const SAMPLE_CAPTION = 'This is how your auto-generated captions will look like.';

/** Only a URL change, so the browser toolbar shows an address. Effects come from demos. */
export const SAMPLE_USER_EVENTS: UserEvents = {
    ...EMPTY_USER_EVENTS,
    urlChanges: [{
        type: EventType.URLCHANGE,
        timestamp: 0,
        mousePos: { x: 0, y: 0 },
        url: 'https://recordio.io/personal-settings',
    }],
};

/** One caption spanning the template; words spread evenly so the first is highlighted at the still. */
function sampleCaptionSegment(timeMapper: TimeMapper): CaptionSegment {
    const text = SAMPLE_CAPTION.split(' ');
    const slot = TEMPLATE_DURATION_MS / text.length;
    const words: Word[] = text.map((word, i) => ({
        id: `sample-word-${i}`,
        word,
        sourceStartTimeMs: Math.round(i * slot),
        sourceEndTimeMs: Math.round((i + 1) * slot),
        outputStartTimeMs: 0,
        outputEndTimeMs: 0,
        visible: false,
    }));
    const [segment] = recomputeOutputTimes([{
        id: 'sample-caption',
        sourceStartTimeMs: 0,
        sourceEndTimeMs: TEMPLATE_DURATION_MS,
        outputStartTimeMs: 0,
        outputEndTimeMs: 0,
        visible: false,
        words: recomputeOutputTimes(words, timeMapper),
    }], timeMapper);
    return segment;
}

export function buildDefaultsTemplateProject(settings: ProjectSettings): Project {
    const outputWindows = [{ id: 'sample-window', startMs: 0, endMs: TEMPLATE_DURATION_MS, speed: 1 }];
    const timeMapper = new TimeMapper(outputWindows);

    return {
        id: DEFAULTS_TEMPLATE_ID,
        schemaVersion: CURRENT_SCHEMA_VERSION,
        autoEffectsGenerated: true,
        screenSource: {
            storagePath: SAMPLE_SCREEN_PATH,
            durationMs: TEMPLATE_DURATION_MS,
            hasAudio: true,
            size: { ...SAMPLE_SCREEN_SIZE },
            // full-frame trackable rect: the toolbar painter draws its own browser chrome
            trackableContentRect: { x: 0, y: 0, ...SAMPLE_SCREEN_SIZE },
        },
        cameraSource: {
            storagePath: SAMPLE_CAMERA_PATH,
            durationMs: TEMPLATE_DURATION_MS,
            size: { ...SAMPLE_CAMERA_SIZE },
        },
        microphoneSource: {
            storagePath: SAMPLE_MIC_PATH,
            durationMs: TEMPLATE_DURATION_MS,
        },
        userEvents: SAMPLE_USER_EVENTS,
        settings: structuredClone(settings),
        timeline: {
            id: 'sample-timeline',
            durationMs: TEMPLATE_DURATION_MS,
            outputWindows,
            zoomSegments: [],
            spotlightSegments: [],
            focusAreas: [],
            captionSegments: [sampleCaptionSegment(timeMapper)],
            cameraMoveSegments: [],
            overlaySegments: [],
            displaySettings: { ...DEFAULT_DISPLAY_SETTINGS },
        },
    };
}
