import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migrateProject } from './migrateProject';
import { CURRENT_SCHEMA_VERSION } from './Project';
import { CDN_ORIGIN } from '@shared/urls';

// Deterministic UUIDs for word generation
let uuidCounter = 0;
vi.stubGlobal('crypto', {
    ...crypto,
    randomUUID: () => `test-uuid-${++uuidCounter}`,
});

beforeEach(() => {
    uuidCounter = 0;
});

function makeV1Project(overrides: Record<string, any> = {}): any {
    return {
        schemaVersion: 1,
        name: 'Test Project',
        createdAt: 1700000000,
        updatedAt: 1700000001,
        screenSource: { storagePath: 'user/proj/screen.webm', durationMs: 10000, size: { width: 1920, height: 1080 }, hasAudio: true },
        userEvents: { mouseClicks: [], mousePositions: [], keyboardEvents: [], drags: [], scrolls: [], typingEvents: [], urlChanges: [], hoveredCards: [] },
        settings: {
            cameraLayout: { position: 'bottom-right', sizePx: 200 },
        },
        timeline: {
            id: 't1',
            durationMs: 10000,
            outputWindows: [{ id: 'w1', startMs: 0, endMs: 10000, speed: 1 }],
            cameraLayoutSegments: [{ id: 'cls1', sourceStartTimeMs: 0, sourceEndTimeMs: 5000 }],
            zoomSegments: [],
            spotlightSegments: [],
            captionSegments: [],
            overlaySegments: [],
            focusAreas: [],
            displaySettings: {
                showZoom: true,
                showSpotlight: true,
                showCameraLayout: true,
            },
        },
        ...overrides,
    };
}

// ==========================================
// v1 → v2: rename cameraLayout → cameraMove
// ==========================================

describe('v1 → v2: cameraLayout rename', () => {
    it('renames timeline.cameraLayoutSegments to cameraMoveSegments', () => {
        const result = migrateProject(makeV1Project());
        expect(result.timeline.cameraMoveSegments).toHaveLength(1);
        expect(result.timeline.cameraMoveSegments[0].id).toBe('cls1');
        expect(result.timeline.cameraLayoutSegments).toBeUndefined();
    });

    it('renames settings.cameraLayout to settings.cameraMove', () => {
        const result = migrateProject(makeV1Project());
        expect(result.settings.cameraMove).toEqual({ position: 'bottom-right', sizePx: 200 });
        expect(result.settings.cameraLayout).toBeUndefined();
    });

    it('renames displaySettings.showCameraLayout to showCameraMove', () => {
        const result = migrateProject(makeV1Project());
        expect(result.timeline.displaySettings.showCameraMove).toBe(true);
        expect(result.timeline.displaySettings.showCameraLayout).toBeUndefined();
    });
});

// ==========================================
// v2 → v3: caption words migration
// ==========================================

describe('v2 → v3: caption words', () => {
    it('generates words from text string', () => {
        const proj = makeV1Project({
            schemaVersion: 2,
            timeline: {
                id: 't1',
                durationMs: 10000,
                outputWindows: [{ id: 'w1', startMs: 0, endMs: 10000, speed: 1 }],
                captionSegments: [{
                    id: 'cap1',
                    sourceStartTimeMs: 1000,
                    sourceEndTimeMs: 3000,
                    text: 'Hello world',
                }],
                zoomSegments: [],
                spotlightSegments: [],
                cameraMoveSegments: [],
                overlaySegments: [],
                focusAreas: [],
            },
        });

        const result = migrateProject(proj);
        const seg = result.timeline.captionSegments[0];

        expect(seg.text).toBeUndefined(); // text removed
        expect(seg.words).toHaveLength(2);
        expect(seg.words[0].word).toBe('Hello');
        expect(seg.words[1].word).toBe('world');
        // Words should span the segment duration
        expect(seg.words[0].sourceStartTimeMs).toBe(1000);
        expect(seg.words[seg.words.length - 1].sourceEndTimeMs).toBe(3000);
    });

    it('preserves existing v3-format words (sourceStartTimeMs)', () => {
        const proj = makeV1Project({
            schemaVersion: 2,
            timeline: {
                id: 't1',
                durationMs: 10000,
                outputWindows: [],
                captionSegments: [{
                    id: 'cap1',
                    sourceStartTimeMs: 0,
                    sourceEndTimeMs: 5000,
                    text: 'old text',
                    words: [
                        { id: 'w1', word: 'existing', sourceStartTimeMs: 0, sourceEndTimeMs: 2500, outputStartTimeMs: 0, outputEndTimeMs: 0, visible: false },
                        { id: 'w2', word: 'words', sourceStartTimeMs: 2500, sourceEndTimeMs: 5000, outputStartTimeMs: 0, outputEndTimeMs: 0, visible: false },
                    ],
                }],
                zoomSegments: [],
                spotlightSegments: [],
                cameraMoveSegments: [],
                overlaySegments: [],
                focusAreas: [],
            },
        });

        const result = migrateProject(proj);
        const seg = result.timeline.captionSegments[0];

        expect(seg.words).toHaveLength(2);
        expect(seg.words[0].word).toBe('existing');
        expect(seg.words[0].id).toBe('w1'); // not regenerated
        expect(seg.text).toBeUndefined();
    });

    it('converts old-format words (sourceStartMs → sourceStartTimeMs)', () => {
        const proj = makeV1Project({
            schemaVersion: 2,
            timeline: {
                id: 't1',
                durationMs: 10000,
                outputWindows: [],
                captionSegments: [{
                    id: 'cap1',
                    sourceStartTimeMs: 0,
                    sourceEndTimeMs: 5000,
                    words: [
                        { id: 'w1', word: 'old', sourceStartMs: 0, sourceEndMs: 2000 },
                        { id: 'w2', word: 'format', sourceStartMs: 2000, sourceEndMs: 5000 },
                    ],
                }],
                zoomSegments: [],
                spotlightSegments: [],
                cameraMoveSegments: [],
                overlaySegments: [],
                focusAreas: [],
            },
        });

        const result = migrateProject(proj);
        const seg = result.timeline.captionSegments[0];

        expect(seg.words[0].sourceStartTimeMs).toBe(0);
        expect(seg.words[0].sourceEndTimeMs).toBe(2000);
        expect(seg.words[0].sourceStartMs).toBeUndefined();
        expect(seg.words[1].sourceStartTimeMs).toBe(2000);
    });

    it('handles empty text → empty words', () => {
        const proj = makeV1Project({
            schemaVersion: 2,
            timeline: {
                id: 't1',
                durationMs: 10000,
                outputWindows: [],
                captionSegments: [{
                    id: 'cap1',
                    sourceStartTimeMs: 0,
                    sourceEndTimeMs: 1000,
                    text: '',
                }],
                zoomSegments: [],
                spotlightSegments: [],
                cameraMoveSegments: [],
                overlaySegments: [],
                focusAreas: [],
            },
        });

        const result = migrateProject(proj);
        expect(result.timeline.captionSegments[0].words).toEqual([]);
    });
});

// ==========================================
// v3 → v4: background URL rewrite
// ==========================================

describe('v3 → v4: background URL rewrite', () => {
    it('rewrites relative background URL to CDN', () => {
        const proj = makeV1Project({
            schemaVersion: 3,
            settings: {
                background: {
                    imageUrl: '/assets/backgrounds/gradient-blue.webp',
                },
            },
        });

        const result = migrateProject(proj);
        expect(result.settings.background.imageUrl).toBe(
            `${CDN_ORIGIN}/backgrounds/gradient-blue.webp`
        );
    });

    it('leaves non-matching URLs untouched', () => {
        const proj = makeV1Project({
            schemaVersion: 3,
            settings: {
                background: {
                    imageUrl: 'https://example.com/custom-bg.png',
                },
            },
        });

        const result = migrateProject(proj);
        expect(result.settings.background.imageUrl).toBe('https://example.com/custom-bg.png');
    });

    it('handles undefined imageUrl', () => {
        const proj = makeV1Project({
            schemaVersion: 3,
            settings: { background: {} },
        });

        const result = migrateProject(proj);
        expect(result.settings.background.imageUrl).toBeUndefined();
    });
});

// ==========================================
// v4 → v5: storagePath backfill (no-op in migration)
// ==========================================

describe('v4 → v5: storagePath', () => {
    it('no structural changes (backfill happens on load)', () => {
        const proj = makeV1Project({ schemaVersion: 4 });
        const result = migrateProject(proj);
        expect(result.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    });
});

// ==========================================
// Common behaviors
// ==========================================

describe('common migration behaviors', () => {
    it('stamps current schema version', () => {
        const result = migrateProject(makeV1Project());
        expect(result.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    });

    it('strips name, createdAt, updatedAt', () => {
        const result = migrateProject(makeV1Project());
        expect(result.name).toBeUndefined();
        expect(result.createdAt).toBeUndefined();
        expect(result.updatedAt).toBeUndefined();
    });

    it('backfills missing displaySettings', () => {
        const proj = makeV1Project();
        delete proj.timeline.displaySettings;
        const result = migrateProject(proj);
        expect(result.timeline.displaySettings).toEqual({
            showZoom: true,
            showSpotlight: true,
            showCameraMove: true,
            collapsed: false,
        });
    });

    it('already-current project only gets version stamped + fields stripped', () => {
        const proj = makeV1Project({ schemaVersion: CURRENT_SCHEMA_VERSION });
        // Remove v1-specific fields that wouldn't exist on a current project
        delete proj.settings.cameraLayout;
        delete proj.timeline.cameraLayoutSegments;
        delete proj.timeline.displaySettings.showCameraLayout;

        const result = migrateProject(proj);
        expect(result.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
        expect(result.name).toBeUndefined();
    });

    it('handles missing schemaVersion (treated as 0)', () => {
        const proj = makeV1Project();
        delete proj.schemaVersion;
        const result = migrateProject(proj);
        // Should run all migrations
        expect(result.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
        expect(result.timeline.cameraMoveSegments).toBeDefined();
    });
});

// ==========================================
// Full chain: v1 all the way to current
// ==========================================

describe('full migration chain v1 → current', () => {
    it('runs all migrations on a v1 project with all legacy fields', () => {
        const proj = {
            schemaVersion: 1,
            name: 'Old Project',
            createdAt: 1700000000,
            updatedAt: 1700000001,
            screenSource: { storagePath: 'u/p/screen.webm', durationMs: 5000, size: { width: 1920, height: 1080 }, hasAudio: true },
            userEvents: { mouseClicks: [], mousePositions: [], keyboardEvents: [], drags: [], scrolls: [], typingEvents: [], urlChanges: [], hoveredCards: [] },
            settings: {
                cameraLayout: { position: 'bottom-left', sizePx: 150 },
                background: { imageUrl: '/assets/backgrounds/dark-mesh.webp' },
                captions: { baselineCaptions: 'some old field' },
            },
            timeline: {
                id: 't1',
                durationMs: 5000,
                outputWindows: [{ id: 'w1', startMs: 0, endMs: 5000, speed: 1 }],
                cameraLayoutSegments: [{ id: 'cls1', sourceStartTimeMs: 0, sourceEndTimeMs: 3000 }],
                captionSegments: [{
                    id: 'cap1',
                    sourceStartTimeMs: 500,
                    sourceEndTimeMs: 2500,
                    text: 'Hello beautiful world',
                }],
                zoomSegments: [],
                spotlightSegments: [],
                overlaySegments: [],
                focusAreas: [],
                displaySettings: {
                    showZoom: true,
                    showSpotlight: true,
                    showCameraLayout: true,
                },
            },
        };

        const result = migrateProject(proj);

        // v1→v2: cameraLayout renamed
        expect(result.settings.cameraMove).toEqual({ position: 'bottom-left', sizePx: 150 });
        expect(result.settings.cameraLayout).toBeUndefined();
        expect(result.timeline.cameraMoveSegments).toHaveLength(1);
        expect(result.timeline.cameraLayoutSegments).toBeUndefined();
        expect(result.timeline.displaySettings.showCameraMove).toBe(true);
        expect(result.timeline.displaySettings.showCameraLayout).toBeUndefined();

        // v2→v3: caption words generated from text
        const cap = result.timeline.captionSegments[0];
        expect(cap.words).toHaveLength(3);
        expect(cap.words.map((w: any) => w.word)).toEqual(['Hello', 'beautiful', 'world']);
        expect(cap.text).toBeUndefined();
        // baselineCaptions cleaned up
        expect(result.settings.captions.baselineCaptions).toBeUndefined();

        // v3→v4: background URL rewritten
        expect(result.settings.background.imageUrl).toBe(`${CDN_ORIGIN}/backgrounds/dark-mesh.webp`);

        // Common: version stamped, metadata stripped
        expect(result.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
        expect(result.name).toBeUndefined();
        expect(result.createdAt).toBeUndefined();
    });
});
