import { describe, it, expect } from 'vitest';
import { CDN_ORIGIN } from '@shared/urls';
import type { ProjectSettings } from '@shared/types';
import { CURRENT_SCHEMA_VERSION, createDefaultSettings } from './Project';
import {
    adaptDefaultsToSources,
    mergeSettingsOntoDefaults,
    resolveProjectDefaults,
    stripRecordingSpecificSettings,
    toStoredProjectDefaults,
} from './projectDefaults';

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

describe('stripRecordingSpecificSettings', () => {
    it('removes per-recording fields, keeps library asset paths, does not mutate the input', () => {
        const input = projectLikeSettings();
        input.zoom.enabled = false;
        input.spotlight.enabled = false;
        const snapshot = structuredClone(input);
        const out = stripRecordingSpecificSettings(input);

        expect(out.screen).not.toHaveProperty('crop');
        expect(out.screen).not.toHaveProperty('outputCrop');
        expect(out.captions).not.toHaveProperty('transcriptionSource');
        expect(out.camera).not.toHaveProperty('faceCenter');
        expect(out.autoCutApplied).toBe(false);
        // track toggles are per recording — defaults keep every track on
        expect(out.zoom.enabled).toBe(true);
        expect(out.spotlight.enabled).toBe(true);

        expect(out.background.storagePath).toBe('user-1/background.webp');
        expect(out.audio.music.storagePath).toBe('user-1/music.mp3');
        expect(input).toEqual(snapshot);
    });

    it('toStoredProjectDefaults stamps the current schema version', () => {
        const stored = toStoredProjectDefaults(projectLikeSettings());
        expect(stored.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
        expect(stored.settings.captions).not.toHaveProperty('transcriptionSource');
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
        const resolved = resolveProjectDefaults({
            schemaVersion: 1,
            settings: {
                cameraLayout: { enabled: false, transitionDurationMs: 123, easing: 'linear' },
                background: { imageUrl: '/assets/backgrounds/bg3.avif', type: 'preset' },
            } as never,
        });
        // renamed group survives; `enabled` is a track toggle, forced on for defaults
        expect(resolved.cameraMove).toEqual({ enabled: true, transitionDurationMs: 123, easing: 'linear' });
        expect(resolved).not.toHaveProperty('cameraLayout');
        expect(resolved.background.imageUrl).toBe(`${CDN_ORIGIN}/backgrounds/bg3.avif`);
    });

    it('backfills groups the blob predates, keeps stored asset paths, strips per-recording fields', () => {
        const factory = createDefaultSettings();
        const resolved = resolveProjectDefaults({
            schemaVersion: CURRENT_SCHEMA_VERSION,
            settings: {
                outputSize: { width: 1080, height: 1920 },
                background: { type: 'custom', storagePath: 'u/bg.webp' },
                screen: { padding: 0.1, crop: { x: 0, y: 0, width: 1, height: 1 } },
                captions: { enabled: false, transcriptionSource: { engine: 'local', language: 'en' } },
                camera: { faceCenter: { x: 0.5, y: 0.5 }, shape: 'square' },
                autoCutApplied: true,
            } as never,
        });

        expect(resolved.overlay).toEqual(factory.overlay);
        expect(resolved.zoom).toEqual(factory.zoom);
        expect(resolved.outputSize).toEqual({ width: 1080, height: 1920 });
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

    it('clamps a camera that would sit outside the output frame', () => {
        const resolved = resolveProjectDefaults({
            schemaVersion: CURRENT_SCHEMA_VERSION,
            settings: {
                outputSize: { width: 1080, height: 1080 },
                camera: { widthPx: 300, heightPx: 300, xPx: 5000, yPx: -50 },
            } as never,
        });
        expect(resolved.camera!.xPx).toBe(1080 - 300);
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
