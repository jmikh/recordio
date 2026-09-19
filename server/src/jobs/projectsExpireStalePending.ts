/**
 * Job `projects.expire-stale-pending` (daily) — trashes projects whose
 * recording never finished uploading (plans/background-activity-oneshot.md).
 *
 * A pending project only ever resumes from the owner's browser cache; one
 * still pending 30 days after creation is abandoned (cache cleared, other
 * device, gave up). Setting `deleted_at` hands it to projects.purge-deleted,
 * which hard-deletes the row and the whole `${created_by}/${id}/` storage
 * prefix — partial tus objects included — 30 days later. Reusing that
 * pipeline rather than deleting here keeps one place that knows how to
 * purge storage.
 *
 * Delete-by-condition and re-run safe: a second run in the same period
 * finds nothing (the rows now have deleted_at). Pending rows the client
 * would still resume are excluded by project-list once trashed, so
 * nothing half-uploaded ever lands in the Trash view.
 */
import type { Deps } from '../deps.js';

export const PROJECTS_EXPIRE_STALE_PENDING_BATCH_LIMIT = 100;

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export interface ProjectsExpireStalePendingResult {
    processed: number;
}

/** One statement, nothing per-row to warn about — no logger needed. */
export async function projectsExpireStalePending(
    deps: Pick<Deps, 'db' | 'clock'>,
): Promise<ProjectsExpireStalePendingResult> {
    const now = deps.clock.now();
    const cutoff = new Date(now.getTime() - THIRTY_DAYS_MS).toISOString();

    // UPDATE has no LIMIT — the sub-select bounds the batch
    const { rows } = await deps.db.query(
        `UPDATE projects SET deleted_at = $1
         WHERE id IN (
             SELECT id FROM projects
             WHERE upload_status = 'pending'
               AND deleted_at IS NULL
               AND permanently_deleted = false
               AND created_at < $2
             ORDER BY created_at
             LIMIT ${PROJECTS_EXPIRE_STALE_PENDING_BATCH_LIMIT}
         )
         RETURNING id`,
        [now.toISOString(), cutoff],
    );

    return { processed: rows.length };
}
