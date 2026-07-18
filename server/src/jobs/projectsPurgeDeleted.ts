/**
 * Job `projects.purge-deleted` (daily) — ports the purge-deleted-projects
 * edge function (Wave C, parity loosened per plan).
 *
 * Permanently deletes projects soft-deleted for more than 30 days
 * (the edge fn's header said "3 days" — its code said 30; the code wins).
 *
 * Per-project pipeline, order load-bearing:
 *   1. mark `permanently_deleted` (skip if already true — resume of a
 *      previous failed run; user can no longer restore)
 *   2. purge ALL of the project's mux_videos via purgeMuxVideo — ANY
 *      status including pending (a 30-day-deleted project has no
 *      legitimate in-flight work). BUG FIX vs the edge fn: it
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
    const cutoff = new Date(deps.clock.now().getTime() - THIRTY_DAYS_MS).toISOString();

    // Oldest first (the edge fn had no ORDER BY — nondeterministic batch)
    const { rows } = await deps.db.query(
        `SELECT id, created_by, permanently_deleted FROM projects
         WHERE deleted_at IS NOT NULL AND deleted_at < $1
         ORDER BY deleted_at
         LIMIT ${PROJECTS_PURGE_BATCH_LIMIT}`,
        [cutoff],
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

            const keys = await deps.s3.listObjects(`${project.created_by}/${project.id}/`);
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
