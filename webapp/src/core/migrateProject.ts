import { CURRENT_SCHEMA_VERSION } from './Project';
import { textToWords } from '@shared/utils/captionUtils';
import { CDN_ORIGIN } from '@shared/types/bridge';
import { DEFAULT_SPOTLIGHT_FEATHER_PX, DEFAULT_SPOTLIGHT_FEATHER_TRANSITION } from '@shared/animators/spotlightAnimator';
import { DEFAULT_EFFECT_AMOUNT } from '@shared/painters/utils/outlineEffects';

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
    // Recording storagePaths are backfilled server-side by project-get
    // (backfillLegacyMediaPaths) — paths are never built on the client.
    if (version < 5) {
        // No structural changes needed — storagePath is backfilled on load.
    }

    // v5 → v6: autoEffectsGenerated flag added. Pre-v6 projects had their auto
    // zoom/spotlight segments computed at creation (upload time), so mark them
    // generated — regenerating would clobber user edits (e.g. deleted zooms).
    if (version < 6) {
        raw.autoEffectsGenerated = true;
    }

    // v6 → v7: the drag effect is retired from the UI, so force it off — a
    // project saved with it on would keep drawing drags nobody can disable.
    // Auto-generation gets its own flag (zoom/spotlight.autoGenerate); the
    // existing `enabled` flags stay the timeline track toggles.
    if (version < 7) {
        if (raw.settings?.mouse) raw.settings.mouse.mouseDragEnabled = false;
        if (raw.settings?.zoom && raw.settings.zoom.autoGenerate === undefined) raw.settings.zoom.autoGenerate = true;
        if (raw.settings?.spotlight && raw.settings.spotlight.autoGenerate === undefined) raw.settings.spotlight.autoGenerate = true;
    }

    // v7 → v8: overlays (blur/text/arrow/border, overlapping single-item
    // segments) are replaced by the blur track. Old overlay segments are
    // dropped, not converted — blurs included.
    if (version < 8) {
        if (raw.timeline) {
            delete raw.timeline.overlaySegments;
            if (raw.timeline.displaySettings) {
                delete raw.timeline.displaySettings.showOverlay;
                raw.timeline.displaySettings.showBlur = true;
            }
        }
        if (raw.settings) delete raw.settings.overlay;
    }

    // v8 → v9: camera/screen hasShadow + hasGlow (+ per-effect amounts) become
    // one `effect` and one `effectAmount`, where 0 is no effect. Shadow wins when
    // both flags were on, as the old picker showed. The border stroke is gone too.
    // A style without either flag (a partial defaults blob) is left for the
    // factory merge to complete.
    if (version < 9) {
        for (const style of [raw.settings?.camera, raw.settings?.screen]) {
            if (!style) continue;
            if (style.hasShadow !== undefined || style.hasGlow !== undefined) {
                const glow = !!style.hasGlow && !style.hasShadow;
                style.effect = glow ? 'glow' : 'shadow';
                style.effectAmount = glow ? style.glowAmount ?? DEFAULT_EFFECT_AMOUNT
                    : style.hasShadow ? style.shadowAmount ?? DEFAULT_EFFECT_AMOUNT
                        : 0;
            }
            delete style.hasShadow;
            delete style.hasGlow;
            delete style.shadowAmount;
            delete style.glowAmount;
            delete style.borderWidthPx;
        }
    }

    // Backfill the blur track if missing (projects saved before blur segments).
    if (raw.timeline && !Array.isArray(raw.timeline.blurSegments)) {
        raw.timeline.blurSegments = [];
    }
    if (raw.settings && !raw.settings.blur) {
        raw.settings.blur = { enabled: true };
    }

    // Backfill spotlight feather settings if missing (projects saved before feathering).
    // Version-independent so the defaults land on every load until the project is re-saved.
    if (raw.settings?.spotlight) {
        const sp = raw.settings.spotlight;
        if (sp.featherPx === undefined) sp.featherPx = DEFAULT_SPOTLIGHT_FEATHER_PX;
        if (sp.featherTransition !== 'fade' && sp.featherTransition !== 'closeIn') {
            sp.featherTransition = DEFAULT_SPOTLIGHT_FEATHER_TRANSITION;
        }
        delete sp.edgeMode;
    }

    // Drop the retired camera feather option (and the unused screen flag it shared
    // StyleSettings with). Version-independent, like edgeMode above.
    if (raw.settings?.camera) {
        delete raw.settings.camera.hasFeather;
        delete raw.settings.camera.featherAmount;
    }
    if (raw.settings?.screen) delete raw.settings.screen.hasFeather;

    // Backfill displaySettings if missing (pre-displaySettings projects)
    if (raw.timeline && !raw.timeline.displaySettings) {
        raw.timeline.displaySettings = {
            showZoom: true,
            showSpotlight: true,
            showCameraMove: true,
            showBlur: true,
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
