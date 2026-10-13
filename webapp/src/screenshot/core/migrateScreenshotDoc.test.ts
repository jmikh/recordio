import { describe, it, expect } from 'vitest';
import { DEFAULT_BACKGROUND, SCREENSHOT_SCHEMA_VERSION } from './createScreenshotDoc';
import { migrateScreenshotDoc } from './migrateScreenshotDoc';

const v1 = {
    id: 's1',
    schemaVersion: 1,
    source: { storagePath: 'p', widthPx: 800, heightPx: 600, devicePixelRatio: 2, captureMode: 'visible' },
    cropPx: null,
    annotations: [],
    annotationDefaults: {},
};

describe('migrateScreenshotDoc', () => {
    it('gives v1 docs the background (off) and no spotlight', () => {
        const doc = migrateScreenshotDoc(v1);
        expect(doc.schemaVersion).toBe(SCREENSHOT_SCHEMA_VERSION);
        expect(doc.background).toEqual(DEFAULT_BACKGROUND);
        expect(doc.background.enabled).toBe(false);
        expect(doc.spotlight).toBeNull();
    });
    it('keeps saved background and spotlight values', () => {
        const spotlight = { id: 'sp', rectPx: { x: 1, y: 2, width: 3, height: 4 }, borderRadiusPx: [0, 0, 0, 0], dimOpacity: 0.7, featherPx: 10 };
        const doc = migrateScreenshotDoc({ ...v1, schemaVersion: 2, background: { enabled: true, padding: 0.2 }, spotlight });
        expect(doc.background).toEqual({ ...DEFAULT_BACKGROUND, enabled: true, padding: 0.2 });
        expect(doc.spotlight).toEqual(spotlight);
    });
});
