/**
 * Personal default project settings — pure logic
 * (plans/user-default-project-settings §3.3).
 *
 * A user's defaults are stored whole as { schemaVersion, settings } on
 * user_profiles.project_defaults (read/written through
 * webapp/src/storage/userDefaultsService.ts). This module turns that blob
 * into a ProjectSettings a new project can be built from, and reduces a
 * project's settings to the parts that are actually preferences before
 * they are stored.
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
 * Every setting the Personal Settings page can actually edit — the editor's
 * six panels rendered in templateMode by
 * webapp/src/pages/settings/personal/DefaultsSettingsPanel.tsx.
 *
 * This is a whitelist on purpose. A user's defaults are written from two
 * places: the page itself, and "Use as my default settings" in the editor
 * header, which promotes a whole project's settings. Anything the page has
 * no control for would then be stuck in the blob with no way to change it
 * or even see it — an aspect ratio, a muted mic, a music track. So a stored
 * blob carries these paths and nothing else; everything absent here always
 * resolves to the shipped factory.
 *
 * Adding a control to one of those panels means adding its path here.
 * Forgetting to fails in the safe direction: the setting just isn't
 * remembered as a default.
 */
export const EDITABLE_DEFAULT_PATHS = [
    // Background tab — every control writes into `background`
    'background',

    // Screen tab. No crop (that rectangle belongs to one recording), no
    // `mute` (the timeline's per-recording track toggle).
    'screen.mode',
    'screen.toolbar',
    'screen.deviceFrameId',
    'screen.borderColor',
    'screen.borderRadiusPx',
    'screen.borderWidthPx',
    'screen.hasShadow',
    'screen.hasGlow',
    'screen.padding',

    // Camera tab. Shape/size come from the shape picker and the size
    // slider; no cropZoom or mirror (both hidden in templateMode), no
    // faceCenter (an anchor picked on one camera video).
    'camera.shape',
    'camera.widthPx',
    'camera.heightPx',
    'camera.xPx',
    'camera.yPx',
    'camera.borderRadiusPx',
    'camera.borderColor',
    'camera.borderWidthPx',
    'camera.hasShadow',
    'camera.hasGlow',
    'camera.hasFeather',
    'camera.featherAmount',
    'camera.autoShrink',
    'camera.shrinkScale',

    // Effects tab. mouseDragEnabled has no control anywhere and is forced
    // off by migrateProject.
    'mouse.mouseClickEnabled',
    'mouse.effectType',
    'mouse.color',
    'mouse.size',
    'mouse.soundEnabled',
    'mouse.soundVolume',
    'keyboard',

    // Captions tab — style only. The engine that transcribed one
    // recording (`transcriptionSource`) is not a preference.
    'captions.enabled',
    'captions.captionSize',
    'captions.width',
    'captions.textColor',
    'captions.backgroundColor',
    'captions.wordHighlight',

    // Motion tab. The `enabled` flags are timeline track toggles (per
    // recording) and stay at the factory's on; the spotlight hold
    // durations are only reachable from the timeline inspector.
    'zoom.autoGenerate',
    'zoom.maxZoom',
    'zoom.transitionDurationMs',
    'zoom.easing',
    'spotlight.autoGenerate',
    'spotlight.enlargeScale',
    'spotlight.dimOpacity',
    'spotlight.transitionDurationMs',
    'spotlight.easing',
] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Copies `a.b.c` from `src` onto `dest` when src has it. Leaves dest alone otherwise. */
function copyPath(src: unknown, dest: Record<string, unknown>, path: string): void {
    const keys = path.split('.');
    let value: unknown = src;
    for (const key of keys) {
        if (!isPlainObject(value)) return;
        value = value[key];
    }
    if (value === undefined) return;

    let target = dest;
    for (const key of keys.slice(0, -1)) {
        const next = target[key];
        if (!isPlainObject(next)) return;
        target = next;
    }
    target[keys[keys.length - 1]] = structuredClone(value);
}

/**
 * A settings tree reduced to what a default may carry: the factory, with
 * EDITABLE_DEFAULT_PATHS copied over from `settings`. Everything else —
 * aspect ratio, frame rate, the whole audio tree, screen mute, camera
 * mirror/crop-zoom, crop, face anchor, transcription source, track
 * toggles, autoCutApplied, the camera-layout and overlay block defaults —
 * comes back at its shipped value.
 *
 * Note `background` and the other listed subtrees are replaced whole, not
 * merged: a custom background is `{ type: 'custom', storagePath, imageUrl:
 * undefined }` and must not inherit the factory's preset image.
 */
export function keepOnlyEditableDefaults(settings: ProjectSettings): ProjectSettings {
    const out = createDefaultSettings() as unknown as Record<string, unknown>;
    for (const path of EDITABLE_DEFAULT_PATHS) copyPath(settings, out, path);
    return out as unknown as ProjectSettings;
}

/** The blob to send to /user-project-defaults-set. */
export function toStoredProjectDefaults(settings: ProjectSettings): StoredProjectDefaults {
    return {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        settings: keepOnlyEditableDefaults(settings),
    };
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
 * is no second migration system. Then they are merged onto the factory
 * (completing subtrees an older blob wrote partially), reduced to the
 * editable paths — so a blob written before this rule still can't force a
 * stuck aspect ratio or music track on new projects — and the camera is
 * clamped into the frame.
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
    const resolved = keepOnlyEditableDefaults(merged);
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
