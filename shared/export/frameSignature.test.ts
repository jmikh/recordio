/**
 * Frame signature — pins the property VFR export relies on: equal signatures
 * ⇔ identical frame. Holds must produce equal signatures (so frames get
 * skipped), anything animating must not, and the first frame after an effect
 * ends must differ from the last frame inside it.
 */
import { describe, expect, it } from 'vitest';
import { computeFrameSignature } from './frameSignature';
import { TimeMapper } from '../mappers/timeMapper';
import { createDefaultSettings, createDefaultTimeline, EMPTY_USER_EVENTS } from '../../webapp/src/core/Project';
import type { BaseEvent, CaptionSegment, CameraMoveSegment, KeyboardEvent, Project, UrlChangeEvent, UserEvents, ZoomSegment } from '../types';

const DURATION_MS = 20_000;
const SCREEN = 'screen.webm';
const CAMERA = 'camera.webm';

function timeSegment(id: string, startMs: number, endMs: number) {
    return {
        id,
        sourceStartTimeMs: startMs,
        sourceEndTimeMs: endMs,
        outputStartTimeMs: startMs,
        outputEndTimeMs: endMs,
        visible: true,
    };
}

function makeProject(): Project {
    const settings = createDefaultSettings();
    settings.mouse.mouseClickEnabled = true;
    settings.keyboard.showHotkeys = true;
    settings.captions.enabled = true;

    const timeline = createDefaultTimeline();
    timeline.durationMs = DURATION_MS;
    timeline.outputWindows = [{ id: 'w1', startMs: 0, endMs: DURATION_MS, speed: 1 }];

    return {
        id: 'p1',
        schemaVersion: 7,
        autoEffectsGenerated: true,
        screenSource: { storagePath: SCREEN, durationMs: DURATION_MS, size: { width: 1920, height: 1080 }, hasAudio: false },
        userEvents: EMPTY_USER_EVENTS,
        settings,
        timeline,
    };
}

function frame(timestamp: number, width = 1920, height = 1080): VideoFrame {
    return { timestamp, displayWidth: width, displayHeight: height } as unknown as VideoFrame;
}

function signatureAt(
    project: Project,
    currentTimeMs: number,
    userEvents: UserEvents = EMPTY_USER_EVENTS,
    frameRefs: Record<string, VideoFrame> = { [SCREEN]: frame(0) }
): string {
    return computeFrameSignature({
        project,
        userEvents,
        timeMapper: new TimeMapper(project.timeline.outputWindows),
        currentTimeMs,
        frameRefs,
    });
}

describe('computeFrameSignature', () => {
    it('is equal across time when nothing changes', () => {
        const project = makeProject();
        expect(signatureAt(project, 1000)).toBe(signatureAt(project, 5000));
    });

    it('changes when the source frame changes', () => {
        const project = makeProject();
        expect(signatureAt(project, 1000, EMPTY_USER_EVENTS, { [SCREEN]: frame(0) }))
            .not.toBe(signatureAt(project, 1000, EMPTY_USER_EVENTS, { [SCREEN]: frame(33_000) }));
    });

    describe('zoom', () => {
        const zoom: ZoomSegment = {
            ...timeSegment('z1', 2000, 8000),
            rectPx: { x: 0, y: 0, width: 960, height: 540 },
            reason: 'test',
            type: 'manual',
            transitionDurationMs: 750,
            easing: 'ease-in-out',
        };
        const project = makeProject();
        project.timeline.zoomSegments = [zoom];

        it('changes during the transition in', () => {
            expect(signatureAt(project, 2100)).not.toBe(signatureAt(project, 2133));
        });

        it('is equal during the hold', () => {
            expect(signatureAt(project, 3000)).toBe(signatureAt(project, 7900));
        });

        it('changes during the zoom out, then returns to the unzoomed signature', () => {
            expect(signatureAt(project, 8100)).not.toBe(signatureAt(project, 8133));
            expect(signatureAt(project, 9000)).toBe(signatureAt(project, 1000));
        });
    });

    describe('clicks', () => {
        const click: BaseEvent = { type: 'click', timestamp: 3000, mousePos: { x: 100, y: 100 } };
        const events: UserEvents = { ...EMPTY_USER_EVENTS, mouseClicks: [click] };
        const project = makeProject();

        it('changes every frame while the ripple animates', () => {
            expect(signatureAt(project, 3100, events)).not.toBe(signatureAt(project, 3133, events));
        });

        it('differs between the last frame inside the ripple and the first frame after it', () => {
            expect(signatureAt(project, 3500, events)).not.toBe(signatureAt(project, 3533, events));
            expect(signatureAt(project, 3533, events)).toBe(signatureAt(project, 2000, events));
        });

        it('ignores clicks when click effects are disabled', () => {
            const disabled = makeProject();
            disabled.settings.mouse.mouseClickEnabled = false;
            expect(signatureAt(disabled, 3100, events)).toBe(signatureAt(disabled, 2000, events));
        });
    });

    describe('keyboard', () => {
        const key: KeyboardEvent = {
            type: 'keydown', timestamp: 5000, mousePos: { x: 0, y: 0 },
            key: 'k', code: 'KeyK', ctrlKey: false, metaKey: true, shiftKey: false, altKey: false,
        };
        const events: UserEvents = { ...EMPTY_USER_EVENTS, keyboardEvents: [key] };
        const project = makeProject();

        it('changes when the key appears', () => {
            expect(signatureAt(project, 4990, events)).not.toBe(signatureAt(project, 5010, events));
        });

        it('is equal while the label holds at full opacity', () => {
            expect(signatureAt(project, 5100, events)).toBe(signatureAt(project, 5900, events));
        });

        it('changes every frame during the fade out', () => {
            expect(signatureAt(project, 6100, events)).not.toBe(signatureAt(project, 6133, events));
        });
    });

    describe('captions', () => {
        const caption: CaptionSegment = {
            ...timeSegment('c1', 10_000, 14_000),
            words: [
                { ...timeSegment('w1', 10_000, 11_000), word: 'one' },
                { ...timeSegment('w2', 11_000, 12_000), word: 'two' },
                { ...timeSegment('w3', 12_000, 14_000), word: 'three' },
            ],
        };
        const project = makeProject();
        project.timeline.captionSegments = [caption];

        it('is equal between word changes', () => {
            expect(signatureAt(project, 10_100)).toBe(signatureAt(project, 10_900));
        });

        it('changes when the next word is highlighted', () => {
            expect(signatureAt(project, 10_900)).not.toBe(signatureAt(project, 11_100));
        });

        it('changes at the (exclusive) segment end', () => {
            expect(signatureAt(project, 13_990)).not.toBe(signatureAt(project, 14_000));
        });
    });

    describe('camera', () => {
        const hiddenBlock: CameraMoveSegment = {
            ...timeSegment('cm1', 2000, 10_000),
            xPx: 0, yPx: 0, widthPx: 300, heightPx: 300,
            shape: 'circle', borderRadiusPx: 150,
            hidden: true,
            transitionDurationMs: 500,
            easing: 'ease-in-out',
        };
        const project = makeProject();
        project.cameraSource = { storagePath: CAMERA, durationMs: DURATION_MS, size: { width: 1280, height: 720 } };
        project.timeline.cameraMoveSegments = [hiddenBlock];

        const refs = (cameraTs: number) => ({ [SCREEN]: frame(0), [CAMERA]: frame(cameraTs, 1280, 720) });

        it('ignores camera frames while the camera is hidden', () => {
            expect(signatureAt(project, 5000, EMPTY_USER_EVENTS, refs(1)))
                .toBe(signatureAt(project, 5000, EMPTY_USER_EVENTS, refs(2)));
        });

        it('tracks camera frames while the camera is visible', () => {
            expect(signatureAt(project, 15_000, EMPTY_USER_EVENTS, refs(1)))
                .not.toBe(signatureAt(project, 15_000, EMPTY_USER_EVENTS, refs(2)));
        });
    });

    describe('toolbar', () => {
        const url = (timestamp: number, href: string): UrlChangeEvent =>
            ({ type: 'urlchange', timestamp, url: href, mousePos: { x: 0, y: 0 } });
        const events: UserEvents = { ...EMPTY_USER_EVENTS, urlChanges: [url(0, 'https://a.com/x'), url(7000, 'https://b.com/y')] };
        const project = makeProject();
        project.settings.screen.toolbar.enabled = true;

        it('changes when the address text changes', () => {
            expect(signatureAt(project, 6000, events)).not.toBe(signatureAt(project, 8000, events));
        });
    });
});
