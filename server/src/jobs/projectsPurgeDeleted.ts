/**
 * Job `projects.purge-deleted` (daily) — ports the purge-deleted-projects
 * edge function (Wave C, parity loosened per plan).
 *
 * Permanently deletes projects soft-deleted for more than 30 days
 * (the edge fn's header said "3 days" — its code said 30; the code wins),
 * plus any trashed project already marked `permanently_deleted` — set by
 * POST /project-delete-permanent ("Delete forever"), or by a previous
 * run that failed partway. Those skip the 30-day wait.
 *
 * A project with a pending render job is skipped until the render
 * settles: the worker ignores the webhook's 404 once the row is gone and
 * still uploads its MP4 under the project prefix, which would orphan it.
 * Stale pending jobs are failed by the stale-job cron, so this can't
 * block a purge forever.
 *
 * Per-project pipeline, order load-bearing:
 *   1. mark `permanently_deleted` (skip if already true — resume of a
 *      previous failed run; user can no longer restore)
 *   2. purge ALL of the project's mux_videos via purgeMuxVideo — ANY
 *      status including pending (a trashed project with no pending
 *      render has no legitimate in-flight work). BUG FIX vs the edge fn: it
 *      hard-deleted the row and let the FK cascade drop mux_videos
 *      WITHOUT deleting their Mux assets — a permanent leak, since the
 *      cascaded row held the only copy of the asset id.
 *   3. delete every storage object under `${created_by}/${project_id}/`.
 *      BUG FIX vs the edge fn: its Supabase-Storage `.list()` was
 *      non-recursive, silently orphaning the `renders/` subfolder on
 *      every purge; S3 prefix listing is recursive. (This also covers
 *      the files render_jobs rows point at, so their cascade is fine.)
 *   4. hard-DELETE the project row — ONLY after 2 and 3 succeeded.
 *
 * A failure anywhere leaves the row (marked) for the next run;
 * per-project catch so one bad row doesn't kill the batch.
 */
import type { Deps } from '../deps.js';
import { purgeMuxVideo, type MuxVideoPurgeTarget } from '../services/muxPurge.js';
import { projectStoragePrefix } from '../services/storagePaths.js';
import type { JobLogger } from './types.js';

export const PROJECTS_PURGE_BATCH_LIMIT = 20;

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

interface CandidateProject {
    id: string;
    created_by: string;
    permanently_deleted: boolean;
}

export interface ProjectsPurgeDeletedResult {
    processed: number;
    succeeded: number;
    failed: number;
}

export async function projectsPurgeDeleted(
    deps: Pick<Deps, 'db' | 's3' | 'mux' | 'clock'>,
    log: JobLogger,
): Promise<ProjectsPurgeDeletedResult> {
    const now = deps.clock.now();
    const cutoff = new Date(now.getTime() - THIRTY_DAYS_MS).toISOString();

    // Oldest first (the edge fn had no ORDER BY — nondeterministic batch).
    // `deleted_at < $2` (now) is always true in prod; it keeps the test
    // suite's pinned 2000-01-01 clock from matching real dev-DB rows.
    const { rows } = await deps.db.query(
        `SELECT p.id, p.created_by, p.permanently_deleted FROM projects p
         WHERE p.deleted_at IS NOT NULL
           AND (p.deleted_at < $1 OR (p.permanently_deleted AND p.deleted_at < $2))
           AND NOT EXISTS (
               SELECT 1 FROM render_jobs rj
               WHERE rj.project_id = p.id AND rj.status = 'pending'
           )
         ORDER BY p.deleted_at
         LIMIT ${PROJECTS_PURGE_BATCH_LIMIT}`,
        [cutoff, now.toISOString()],
    );
    const projects = rows as CandidateProject[];

    let succeeded = 0;
    let failed = 0;

    for (const project of projects) {
        try {
            if (!project.permanently_deleted) {
                await deps.db.query(
                    'UPDATE projects SET permanently_deleted = true WHERE id = $1',
                    [project.id],
                );
            }

            const { rows: muxRows } = await deps.db.query(
                'SELECT id, mux_asset_id, render_storage_path FROM mux_videos WHERE project_id = $1',
                [project.id],
            );
            for (const muxRow of muxRows as MuxVideoPurgeTarget[]) {
                await purgeMuxVideo(deps, muxRow);
            }

            const keys = await deps.s3.listObjects(projectStoragePrefix(project.created_by, project.id));
            await deps.s3.deleteObjects(keys);

            await deps.db.query('DELETE FROM projects WHERE id = $1', [project.id]);
            succeeded++;
        } catch (err) {
            failed++;
            log.warn(
                { err, 'project.id': project.id },
                'projects.purge-deleted: project purge failed, will retry next run',
            );
        }
    }

    return { processed: projects.length, succeeded, failed };
}
