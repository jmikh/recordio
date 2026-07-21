/**
 * Job `render_jobs.purge-superseded` (daily) — NEW in Wave C, no edge-fn
 * ancestor: `cron_render_purge` posted hourly to a `render-purge` edge
 * function that never existed (silent pg_net 404s), so old-version
 * render files were never purged. This implements what that cron's
 * comment intended, mirroring the mux candidates shape.
 *
 * Candidates: render_jobs below the highest COMPLETED version per
 * project, non-pending, LIMIT 50 — plain SQL over the pool (this logic
 * is server-exclusive from birth; no sql/functions file). Per row:
 * delete the render file (skip if NULL path) → DELETE the row ONLY
 * after the file is confirmed gone. The latest completed render
 * survives by construction — its file backs the user's mp4 download
 * (useCloudRender presigns it); do not widen the candidate set.
 *
 * A superseded mux_videos row may still reference a superseded render
 * file — fine: Mux ingested it long ago, and the reference is only
 * used for purging.
 *
 * `onlyIds` is the same TEST-ONLY scoping seam as
 * muxVideosPurgeSuperseded (global query vs the shared local dev DB);
 * production callers pass nothing.
 */
import type { Deps } from '../deps.js';
import type { JobLogger } from './types.js';
import type { PurgeSupersededResult } from './muxVideosPurgeSuperseded.js';

export const RENDER_PURGE_BATCH_LIMIT = 50;

interface CandidateRenderJob {
    id: string;
    render_storage_path: string | null;
}

export async function renderJobsPurgeSuperseded(
    deps: Pick<Deps, 'db' | 's3'>,
    log: JobLogger,
    opts: { onlyIds?: string[] } = {},
): Promise<PurgeSupersededResult> {
    const { rows } = await deps.db.query(
        `SELECT rj.id, rj.render_storage_path
         FROM render_jobs rj
         JOIN (
             SELECT project_id, MAX(cloud_version) AS max_version
             FROM render_jobs
             WHERE status = 'completed'
             GROUP BY project_id
         ) latest ON rj.project_id = latest.project_id
         WHERE rj.cloud_version < latest.max_version
           AND rj.status != 'pending'
         LIMIT ${RENDER_PURGE_BATCH_LIMIT}`,
    );
    const candidates = (rows as CandidateRenderJob[]).filter(
        (row) => !opts.onlyIds || opts.onlyIds.includes(row.id),
    );

    let purged = 0;
    for (const row of candidates) {
        try {
            if (row.render_storage_path) {
                await deps.s3.deleteObjects([row.render_storage_path]);
            }
            await deps.db.query('DELETE FROM render_jobs WHERE id = $1', [row.id]);
            purged++;
        } catch (err) {
            log.warn(
                { err, 'render.job_id': row.id },
                'render_jobs.purge-superseded: row purge failed, will retry next run',
            );
        }
    }

    return { purged, total: candidates.length };
}
