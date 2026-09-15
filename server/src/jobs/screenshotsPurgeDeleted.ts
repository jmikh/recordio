/**
 * Job `screenshots.purge-deleted` (daily) — the screenshot counterpart
 * of projects.purge-deleted (plans/screenshots, Step 2).
 *
 * Permanently deletes screenshots soft-deleted for more than 30 days.
 * Per-screenshot pipeline, order load-bearing:
 *   1. mark `permanently_deleted` (skip if already true — resume of a
 *      previous failed run; the user can no longer restore)
 *   2. delete every storage object under
 *      `${created_by}/screenshots/${id}/` (source, thumbnail, renders —
 *      S3 prefix listing is recursive)
 *   3. hard-DELETE the row — ONLY after 2 succeeded.
 *
 * No Mux involvement (screenshots have no video). A failure leaves the
 * row (marked) for the next run; per-row catch so one bad row doesn't
 * kill the batch.
 */
import type { Deps } from '../deps.js';
import { screenshotStoragePrefix } from '../services/screenshotAccess.js';
import type { JobLogger } from './types.js';

export const SCREENSHOTS_PURGE_BATCH_LIMIT = 50;

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

interface CandidateScreenshot {
    id: string;
    created_by: string;
    permanently_deleted: boolean;
}

export interface ScreenshotsPurgeDeletedResult {
    processed: number;
    succeeded: number;
    failed: number;
}

export async function screenshotsPurgeDeleted(
    deps: Pick<Deps, 'db' | 's3' | 'clock'>,
    log: JobLogger,
): Promise<ScreenshotsPurgeDeletedResult> {
    const cutoff = new Date(deps.clock.now().getTime() - THIRTY_DAYS_MS).toISOString();

    const { rows } = await deps.db.query(
        `SELECT id, created_by, permanently_deleted FROM screenshots
         WHERE deleted_at IS NOT NULL AND deleted_at < $1
         ORDER BY deleted_at
         LIMIT ${SCREENSHOTS_PURGE_BATCH_LIMIT}`,
        [cutoff],
    );
    const screenshots = rows as CandidateScreenshot[];

    let succeeded = 0;
    let failed = 0;

    for (const screenshot of screenshots) {
        try {
            if (!screenshot.permanently_deleted) {
                await deps.db.query(
                    'UPDATE screenshots SET permanently_deleted = true WHERE id = $1',
                    [screenshot.id],
                );
            }

            const keys = await deps.s3.listObjects(
                screenshotStoragePrefix(screenshot.created_by, screenshot.id),
            );
            await deps.s3.deleteObjects(keys);

            await deps.db.query('DELETE FROM screenshots WHERE id = $1', [screenshot.id]);
            succeeded++;
        } catch (err) {
            failed++;
            log.warn(
                { err, 'screenshot.id': screenshot.id },
                'screenshots.purge-deleted: screenshot purge failed, will retry next run',
            );
        }
    }

    return { processed: screenshots.length, succeeded, failed };
}
