import { CURRENT_SCHEMA_VERSION } from './Project';

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

    // Stamp current version
    raw.schemaVersion = CURRENT_SCHEMA_VERSION;
    return raw;
}
