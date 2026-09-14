/**
 * Personal default project settings — pure logic
 * (plans/user-default-project-settings §3.3).
 *
 * A user's defaults are stored whole as { schemaVersion, settings } on
 * user_profiles.project_defaults (read/written through
 * webapp/src/storage/userDefaultsService.ts). This module turns that blob
 * into a ProjectSettings a new project can be built from, and strips the
 * parts of a project's settings that describe one recording rather than
 * a preference before they are stored.
 *
 * NULL / missing stored defaults resolve to the shipped factory
 * (createDefaultSettings) — nothing is ever seeded for a user.
 */
import type { CameraMetadata, ProjectSettings } from '@shared/types';
import type { StoredProjectDefaults } from '@shared/api';
import { fitCameraToSource, clampCameraToOutput } from '@shared/utils/cameraShape';
import {
    CURRENT_SCHEMA_VERSION,
    EMPTY_USER_EVENTS,
    createDefaultSettings,
    createDefaultTimeline,
    createPlaceholderSource,
} from './Project';
import { migrateProject } from './migrateProject';

/**
 * Removes the fields that belong to one specific recording:
 * - screen.crop (crop rectangle of that video), screen.outputCrop (dead field)
 * - camera.faceCenter (face-tracking anchor picked on that camera video)
 * - captions.transcriptionSource (which engine transcribed that audio)
 * - autoCutApplied (analytics flag for that project)
 *
 * Keeps background.storagePath / audio.music.storagePath — they point at
 * the user's asset library (user_assets), which is user-scoped and
 * cross-project, so a custom background or track can be a default.
 */
export function stripRecordingSpecificSettings(settings: ProjectSettings): ProjectSettings {
    const out: ProjectSettings = structuredClone(settings);
    delete out.screen.crop;
    delete out.screen.outputCrop;
    delete out.captions.transcriptionSource;
    if (out.camera) delete out.camera.faceCenter;
    out.autoCutApplied = false;
    // The `enabled` flags are the timeline track toggles (per recording); a
    // default never disables a track. Auto-generation is its own flag.
    out.zoom.enabled = true;
    out.spotlight.enabled = true;
    if (out.cameraMove) out.cameraMove.enabled = true;
    if (out.overlay) out.overlay.enabled = true;
    return out;
}

/** The blob to send to /user-project-defaults-set. */
export function toStoredProjectDefaults(settings: ProjectSettings): StoredProjectDefaults {
    return {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        settings: stripRecordingSpecificSettings(settings),
    };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Deep-merges a stored settings tree onto the factory defaults so a
 * blob written before a field existed still yields a complete
 * ProjectSettings (the same job useProjectStore.loadProject's backfills do
 * for old projects, without duplicating the literals):
 * - plain objects recurse
 * - arrays and primitives from the stored tree win (gradientColors is a
 *   tuple, replaced whole)
 * - undefined / null stored values are skipped (the factory value stays)
 * - stored keys the factory lacks are kept (e.g. background.storagePath)
 */
export function mergeSettingsOntoDefaults<T extends object>(base: T, override: unknown): T {
    if (!isPlainObject(override)) return base;
    const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
    for (const [key, value] of Object.entries(override)) {
        if (value === undefined || value === null) continue;
        const current = out[key];
        out[key] = isPlainObject(current) && isPlainObject(value)
            ? mergeSettingsOntoDefaults(current, value)
            : value;
    }
    return out as T;
}

/**
 * Stored blob (or null) → a complete, current-schema ProjectSettings.
 *
 * The stored settings ride the ordinary project migrations by being
 * wrapped in a synthetic project and run through migrateProject — there
 * is no second migration system. Then they are merged onto the factory,
 * stripped again (defensive) and the camera is clamped into the frame.
 */
export function resolveProjectDefaults(stored: StoredProjectDefaults | null | undefined): ProjectSettings {
    const factory = createDefaultSettings();
    if (!stored || !isPlainObject(stored) || !isPlainObject(stored.settings)) return factory;

    const migrated = migrateProject({
        schemaVersion: typeof stored.schemaVersion === 'number' ? stored.schemaVersion : 0,
        autoEffectsGenerated: true,
        screenSource: createPlaceholderSource(),
        userEvents: EMPTY_USER_EVENTS,
        settings: structuredClone(stored.settings),
        timeline: createDefaultTimeline(),
    }) as { settings: unknown };

    const merged = mergeSettingsOntoDefaults(factory, migrated.settings);
    const resolved = stripRecordingSpecificSettings(merged);
    if (resolved.camera) {
        resolved.camera = clampCameraToOutput(resolved.camera, resolved.outputSize);
    }
    return resolved;
}

/**
 * Fits resolved defaults to the recording they are about to be applied
 * to: the defaults were authored against a sample camera, so a 'rect'
 * bubble is re-sized to the real camera's aspect (square/circle stay as
 * they are) and clamped. No camera → settings are used as they are.
 */
export function adaptDefaultsToSources(
    settings: ProjectSettings,
    cameraSource: CameraMetadata | undefined,
): ProjectSettings {
    if (!settings.camera || !cameraSource) return settings;
    return {
        ...settings,
        camera: fitCameraToSource(settings.camera, cameraSource.size, settings.outputSize),
    };
}
