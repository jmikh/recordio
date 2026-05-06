import { CURRENT_SCHEMA_VERSION } from './Project';
import { textToWords } from '@shared/utils/captionUtils';
import { CDN_ORIGIN } from '@shared/types/bridge';

/** Weight per word: letter count + base value. Matches textToWords(). */
const WORD_BASE_VALUE = 3;

/**
 * Convert a legacy caption segment (has text, may lack words) into the v3
 * format where words[] is required and text is removed.
 */
function migrateCaptionSegment(seg: any): any {
    // Already has words in v3 format (sourceStartTimeMs on words)
    if (Array.isArray(seg.words) && seg.words.length > 0 && seg.words[0].sourceStartTimeMs !== undefined) {
        delete seg.text;
        return seg;
    }

    // Has words in old format (sourceStartMs / sourceEndMs) — rename fields
    if (Array.isArray(seg.words) && seg.words.length > 0 && seg.words[0].sourceStartMs !== undefined) {
        seg.words = seg.words.map((w: any) => ({
            id: w.id ?? crypto.randomUUID(),
            word: w.word,
            sourceStartTimeMs: w.sourceStartMs,
            sourceEndTimeMs: w.sourceEndMs,
            outputStartTimeMs: 0,
            outputEndTimeMs: 0,
            visible: false,
        }));
        delete seg.text;
        return seg;
    }

    // No words — generate from text + segment timing
    const text: string = seg.text ?? '';
    seg.words = textToWords(text, seg.sourceStartTimeMs ?? 0, seg.sourceEndTimeMs ?? 0);
    delete seg.text;
    return seg;
}

/**
 * Migrates a raw project loaded from storage to the current schema.
 * Runs step-by-step from the project's version to CURRENT_SCHEMA_VERSION.
 *
 * Add new migrations as:
 *   if (version < 2) { raw = migrateV1toV2(raw); }
 */
export function migrateProject(raw: any): any {
    const version: number = raw.schemaVersion ?? 0;

    // v1 → v2: rename cameraLayout → cameraMove
    if (version < 2) {
        if (raw.timeline?.cameraLayoutSegments) {
            raw.timeline.cameraMoveSegments = raw.timeline.cameraLayoutSegments;
            delete raw.timeline.cameraLayoutSegments;
        }
        if (raw.settings?.cameraLayout) {
            raw.settings.cameraMove = raw.settings.cameraLayout;
            delete raw.settings.cameraLayout;
        }
        if (raw.timeline?.displaySettings?.showCameraLayout !== undefined) {
            raw.timeline.displaySettings.showCameraMove = raw.timeline.displaySettings.showCameraLayout;
            delete raw.timeline.displaySettings.showCameraLayout;
        }
    }

    // v2 → v3: CaptionSegment.text removed, words[] required (Word extends TimeSegment)
    if (version < 3) {
        if (Array.isArray(raw.timeline?.captionSegments)) {
            raw.timeline.captionSegments = raw.timeline.captionSegments.map(migrateCaptionSegment);
        }
        // Clean up removed baseline captions field
        if (raw.settings?.captions?.baselineCaptions) {
            delete raw.settings.captions.baselineCaptions;
        }
    }

    // v3 → v4: rewrite preset background imageUrl from relative to CDN
    if (version < 4) {
        const bgUrl = raw.settings?.background?.imageUrl;
        if (typeof bgUrl === 'string' && bgUrl.startsWith('/assets/backgrounds/')) {
            raw.settings.background.imageUrl = bgUrl.replace(
                '/assets/backgrounds/',
                `${CDN_ORIGIN}/backgrounds/`
            );
        }
    }

    // v4 → v5: storagePath added to BaseSourceMetadata, BackgroundSettings, MusicSettings.
    // storagePath is populated in CloudProjectService.loadProject() using the
    // deterministic path pattern (userId/projectId/fileType.ext) because the
    // migration function doesn't have access to userId.
    if (version < 5) {
        // No structural changes needed — storagePath is backfilled on load.
    }

    // Backfill displaySettings if missing (pre-displaySettings projects)
    if (raw.timeline && !raw.timeline.displaySettings) {
        raw.timeline.displaySettings = {
            showZoom: true,
            showSpotlight: true,
            showCameraMove: true,
            collapsed: false,
        };
    }

    // Strip fields that are now DB-only columns (not part of project_data)
    delete raw.name;
    delete raw.createdAt;
    delete raw.updatedAt;

    // Stamp current version
    raw.schemaVersion = CURRENT_SCHEMA_VERSION;
    return raw;
}
