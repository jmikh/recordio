/**
 * ScreenshotDoc migrations (plans/screenshots) — same rules as
 * core/migrateProject.ts: bump SCREENSHOT_SCHEMA_VERSION, add a
 * `if (version < N)` block (they run sequentially), and backfill new
 * optional fields version-independently at the bottom.
 */
import type { ScreenshotDoc } from '@shared/types';
import { DEFAULT_ANNOTATION_DEFAULTS, SCREENSHOT_SCHEMA_VERSION } from './createScreenshotDoc';

export function migrateScreenshotDoc(raw: unknown): ScreenshotDoc {
    const doc = { ...(raw as ScreenshotDoc) };
    const version = typeof doc.schemaVersion === 'number' ? doc.schemaVersion : 0;

    // (no versioned migrations yet)

    // Version-independent backfills
    if (!Array.isArray(doc.annotations)) doc.annotations = [];
    if (doc.cropPx === undefined) doc.cropPx = null;
    doc.annotationDefaults = { ...DEFAULT_ANNOTATION_DEFAULTS, ...(doc.annotationDefaults ?? {}) };

    if (version < SCREENSHOT_SCHEMA_VERSION) doc.schemaVersion = SCREENSHOT_SCHEMA_VERSION;
    return doc;
}
