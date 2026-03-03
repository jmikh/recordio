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

    // --- future migrations go here ---
    // if (version < 2) { raw = migrateV1toV2(raw); }

    // Stamp current version
    raw.schemaVersion = CURRENT_SCHEMA_VERSION;
    return raw;
}
