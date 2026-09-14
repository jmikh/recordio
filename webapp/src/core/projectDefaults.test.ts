import { describe, it, expect } from 'vitest';
import { CDN_ORIGIN } from '@shared/urls';
import type { ProjectSettings } from '@shared/types';
import { CURRENT_SCHEMA_VERSION, createDefaultSettings } from './Project';
import {
    EDITABLE_DEFAULT_PATHS,
    adaptDefaultsToSources,
    keepOnlyEditableDefaults,
    mergeSettingsOntoDefaults,
    resolveProjectDefaults,
    toStoredProjectDefaults,
} from './projectDefaults';

/** A settings tree as it comes off a real project — the "Use as my defaults" input. */
function projectLikeSettings(): ProjectSettings {
    const s = createDefaultSettings();
    s.screen.crop = { x: 10, y: 10, width: 500, height: 300 };
    s.screen.outputCrop = '16:9';
    s.captions.transcriptionSource = { engine: 'openai', language: 'en' };
    s.camera!.faceCenter = { x: 0.4, y: 0.6 };
    s.autoCutApplied = true;
    s.background = { ...s.background, type: 'custom', storagePath: 'user-1/background.webp', imageUrl: undefined };
    s.audio.music = { ...s.audio.music, source: 'custom', storagePath: 'user-1/music.mp3', enabled: true };
    return s;
}

function valueAt(settings: ProjectSettings, path: string): unknown {
    return path.split('.').reduce<unknown>(
        (node, key) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[key] : undefined),
        settings,
    );
}

describe('keepOnlyEditableDefaults', () => {
    it('every listed path exists in the factory (catches a typo in the whitelist)', () => {
        const factory = createDefaultSettings();
        for (const path of EDITABLE_DEFAULT_PATHS) {
            expect(valueAt(factory, path), path).toBeDefined();
        }
    });

    it('keeps what the Personal Settings page can edit, across every tab', () => {
        const s = createDefaultSettings();
        s.background = { ...s.background, type: 'custom', storagePath: 'user-1/background.webp', imageUrl: undefined };
        s.screen.padding = 0.11;
        s.screen.toolbar = { enabled: false, theme: 'dark', urlMode: 'full' };
        s.camera = { ...s.camera!, shape: 'rect', shrinkScale: 0.31, borderColor: '#abcdef' };
        s.mouse = { ...s.mouse, color: '#123456', size: 1.7 };
        s.keyboard = { ...s.keyboard, hotkeysPlacement: 'bottom', hotkeysSize: 1.4 };
        s.captions = { ...s.captions, textColor: '#00ff00', width: 42 };
        s.zoom = { ...s.zoom, maxZoom: 2.7, easing: 'linear' };
        s.spotlight = { ...s.spotlight, dimOpacity: 0.9 };

        const out = keepOnlyEditableDefaults(s);

        expect(out.background.type).toBe('custom');
        expect(out.background.storagePath).toBe('user-1/background.webp');
        expect(out.background.imageUrl).toBeUndefined();
        expect(out.screen.padding).toBe(0.11);
        expect(out.screen.toolbar).toEqual({ enabled: false, theme: 'dark', urlMode: 'full' });
        expect(out.camera!.shape).toBe('rect');
        expect(out.camera!.shrinkScale).toBe(0.31);
        expect(out.camera!.borderColor).toBe('#abcdef');
        expect(out.mouse.color).toBe('#123456');
        expect(out.mouse.size).toBe(1.7);
        expect(out.keyboard.hotkeysPlacement).toBe('bottom');
        expect(out.captions.textColor).toBe('#00ff00');
        expect(out.captions.width).toBe(42);
        expect(out.zoom.maxZoom).toBe(2.7);
        expect(out.zoom.easing).toBe('linear');
        expect(out.spotlight.dimOpacity).toBe(0.9);
    });

    it('resets everything the page cannot reach to the factory', () => {
        const factory = createDefaultSettings();
        const s = projectLikeSettings();
        s.outputSize = { width: 1080, height: 1920 };
        s.frameRate = 30;
        s.screen.mute = true;
        s.camera = { ...s.camera!, mirrored: true, cropZoom: 2.5 };
        s.audio = { ...s.audio, muteMicrophone: true, screenVolume: 0.2 };
        s.zoom.enabled = false;
        s.spotlight.enabled = false;
        s.spotlight.defaultHoldDurationMs = 4000;
        s.cameraMove = { ...s.cameraMove!, transitionDurationMs: 4321 };
        s.overlay = { ...s.overlay!, defaultDurationMs: 9000 };
        const snapshot = structuredClone(s);

        const out = keepOnlyEditableDefaults(s);

        // aspect ratio and frame rate: no control on the page
        expect(out.outputSize).toEqual(factory.outputSize);
        expect(out.frameRate).toBe(factory.frameRate);
        // the Audio tab is not on the page at all — music track included
        expect(out.audio).toEqual(factory.audio);
        expect(out.screen.mute).toBe(false);
        // hidden in templateMode
        expect(out.camera!.mirrored).toBe(false);
        expect(out.camera!.cropZoom).toBe(1);
        // per-recording fields
        expect(out.screen).not.toHaveProperty('crop');
        expect(out.screen).not.toHaveProperty('outputCrop');
        expect(out.captions).not.toHaveProperty('transcriptionSource');
        expect(out.camera).not.toHaveProperty('faceCenter');
        expect(out.autoCutApplied).toBe(false);
        // track toggles — a default keeps every track on
        expect(out.zoom.enabled).toBe(true);
        expect(out.spotlight.enabled).toBe(true);
        // only reachable from the timeline inspectors
        expect(out.spotlight.defaultHoldDurationMs).toBe(factory.spotlight.defaultHoldDurationMs);
        expect(out.cameraMove).toEqual(factory.cameraMove);
        expect(out.overlay).toEqual(factory.overlay);

        expect(s).toEqual(snapshot);
    });

    it('toStoredProjectDefaults stamps the current schema version', () => {
        const stored = toStoredProjectDefaults(projectLikeSettings());
        expect(stored.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
        expect(stored.settings.captions).not.toHaveProperty('transcriptionSource');
        expect(stored.settings.audio).toEqual(createDefaultSettings().audio);
    });
});

describe('mergeSettingsOntoDefaults', () => {
    it('recurses objects, replaces arrays whole, skips null/undefined, keeps unknown keys', () => {
        const base = { a: { x: 1, y: 2, list: [1, 2] }, b: 'base', c: 3 };
        const out = mergeSettingsOntoDefaults(base, {
            a: { x: 10, list: [9], extra: true },
            b: undefined,
            c: null,
            d: 'new',
        });
        expect(out).toEqual({ a: { x: 10, y: 2, list: [9], extra: true }, b: 'base', c: 3, d: 'new' });
    });

    it('returns the base untouched for a non-object override', () => {
        const base = { a: 1 };
        expect(mergeSettingsOntoDefaults(base, 'nope')).toBe(base);
        expect(mergeSettingsOntoDefaults(base, null)).toBe(base);
    });
});

describe('resolveProjectDefaults', () => {
    it('null / malformed → the shipped factory defaults', () => {
        const factory = createDefaultSettings();
        expect(resolveProjectDefaults(null)).toEqual(factory);
        expect(resolveProjectDefaults(undefined)).toEqual(factory);
        expect(resolveProjectDefaults({ schemaVersion: 6, settings: 'junk' } as never)).toEqual(factory);
    });

    it('runs the project migrations on the settings sub-tree (v1 rename, v3 CDN rewrite)', () => {
        const factory = createDefaultSettings();
        const resolved = resolveProjectDefaults({
            schemaVersion: 1,
            settings: {
                cameraLayout: { enabled: false, transitionDurationMs: 123, easing: 'linear' },
                background: { imageUrl: '/assets/backgrounds/bg3.avif', type: 'preset' },
            } as never,
        });
        // the v1 rename ran — no stray `cameraLayout` key survives. Its contents
        // are not editable from the page, so they land back on the factory.
        expect(resolved).not.toHaveProperty('cameraLayout');
        expect(resolved.cameraMove).toEqual(factory.cameraMove);
        expect(resolved.background.imageUrl).toBe(`${CDN_ORIGIN}/backgrounds/bg3.avif`);
    });

    it('backfills groups the blob predates, keeps stored asset paths, strips per-recording fields', () => {
        const factory = createDefaultSettings();
        const resolved = resolveProjectDefaults({
            schemaVersion: CURRENT_SCHEMA_VERSION,
            settings: {
                background: { type: 'custom', storagePath: 'u/bg.webp' },
                screen: { padding: 0.1, crop: { x: 0, y: 0, width: 1, height: 1 } },
                captions: { enabled: false, transcriptionSource: { engine: 'local', language: 'en' } },
                camera: { faceCenter: { x: 0.5, y: 0.5 }, shape: 'square' },
                autoCutApplied: true,
            } as never,
        });

        expect(resolved.overlay).toEqual(factory.overlay);
        expect(resolved.zoom).toEqual(factory.zoom);
        expect(resolved.background.type).toBe('custom');
        expect(resolved.background.storagePath).toBe('u/bg.webp');
        expect(resolved.background.gradientColors).toEqual(factory.background.gradientColors);
        expect(resolved.screen.padding).toBe(0.1);
        expect(resolved.screen.borderRadiusPx).toBe(factory.screen.borderRadiusPx);
        expect(resolved.screen).not.toHaveProperty('crop');
        expect(resolved.captions.enabled).toBe(false);
        expect(resolved.captions).not.toHaveProperty('transcriptionSource');
        expect(resolved.camera!.shape).toBe('square');
        expect(resolved.camera).not.toHaveProperty('faceCenter');
        expect(resolved.autoCutApplied).toBe(false);
    });

    it('ignores an aspect ratio and audio a blob written before this rule still carries', () => {
        const factory = createDefaultSettings();
        const resolved = resolveProjectDefaults({
            schemaVersion: CURRENT_SCHEMA_VERSION,
            settings: {
                outputSize: { width: 1080, height: 1920 },
                audio: { muteMicrophone: true, music: { enabled: true, source: 'custom', storagePath: 'u/track.mp3' } },
                screen: { mute: true },
                camera: { mirrored: true, cropZoom: 2 },
            } as never,
        });

        expect(resolved.outputSize).toEqual(factory.outputSize);
        expect(resolved.audio).toEqual(factory.audio);
        expect(resolved.screen.mute).toBe(false);
        expect(resolved.camera!.mirrored).toBe(false);
        expect(resolved.camera!.cropZoom).toBe(1);
    });

    it('clamps a camera that would sit outside the output frame', () => {
        const resolved = resolveProjectDefaults({
            schemaVersion: CURRENT_SCHEMA_VERSION,
            settings: {
                camera: { widthPx: 300, heightPx: 300, xPx: 5000, yPx: -50 },
            } as never,
        });
        // clamped against the factory output size — the blob cannot change it
        expect(resolved.camera!.xPx).toBe(1920 - 300);
        expect(resolved.camera!.yPx).toBe(0);
    });
});

describe('adaptDefaultsToSources', () => {
    it('re-sizes a rect bubble to the real camera aspect and clamps it', () => {
        const settings = createDefaultSettings();
        settings.camera = { ...settings.camera!, shape: 'rect', widthPx: 400, heightPx: 300, xPx: 1700, yPx: 100 };
        const out = adaptDefaultsToSources(settings, { storagePath: 'c', durationMs: 1, size: { width: 640, height: 480 } });
        expect(out.camera!.widthPx).toBe(400); // 300 * 4/3
        expect(out.camera!.heightPx).toBe(300);
        expect(out.camera!.xPx).toBe(1920 - 400);
    });

    it('leaves square/circle bubbles and camera-less recordings alone', () => {
        const settings = createDefaultSettings();
        const circle = adaptDefaultsToSources(settings, { storagePath: 'c', durationMs: 1, size: { width: 1280, height: 720 } });
        expect(circle.camera).toEqual(settings.camera);
        expect(adaptDefaultsToSources(settings, undefined)).toBe(settings);
    });
});
