/**
 * Job `mux_videos.purge-superseded` (daily; the old cron was hourly —
 * user decision 2026-07-18, purges have no urgency) — ports the
 * mux-video-purge edge function (Wave C, parity loosened per plan).
 *
 * Candidates: mux_videos below the highest COMPLETED version per
 * project, non-pending, LIMIT 50 — plain SQL over the pool, mirroring
 * renderJobsPurgeSuperseded exactly. The `mux_video_purge_candidates()`
 * DB function this used to call died with the soft-delete removal
 * (2026-07-22): since multiple completed rows per project are legal
 * now, older completed versions simply wait here for the daily sweep.
 * Each candidate is purged via the shared purgeMuxVideo helper (Mux
 * asset → render file → row, row last). Per-row catch — a failed row
 * is left for the next run.
 *
 * `onlyIds` is a TEST-ONLY scoping seam: the candidates query is global,
 * and the e2e suite runs against the shared long-lived local dev DB —
 * an unscoped run would delete REAL local rows while the Mux/S3
 * deletions hit fakes, leaking the very assets this job exists to
 * clean up. Production callers (jobs/index.ts) pass nothing.
 */
import type { Deps } from '../deps.js';
import { purgeMuxVideo, type MuxVideoPurgeTarget } from '../services/muxPurge.js';
import type { JobLogger } from './types.js';

export const MUX_PURGE_BATCH_LIMIT = 50;

export interface PurgeSupersededResult {
    purged: number;
    total: number;
}

export async function muxVideosPurgeSuperseded(
    deps: Pick<Deps, 'db' | 'mux' | 's3'>,
    log: JobLogger,
    opts: { onlyIds?: string[] } = {},
): Promise<PurgeSupersededResult> {
    const { rows } = await deps.db.query(
        `SELECT mv.id, mv.mux_asset_id, mv.render_storage_path
         FROM mux_videos mv
         JOIN (
             SELECT project_id, MAX(cloud_version) AS max_version
             FROM mux_videos
             WHERE status = 'completed'
             GROUP BY project_id
         ) latest ON mv.project_id = latest.project_id
         WHERE mv.cloud_version < latest.max_version
           AND mv.status != 'pending'
         LIMIT ${MUX_PURGE_BATCH_LIMIT}`,
    );
    const candidates = (rows as MuxVideoPurgeTarget[]).filter(
        (row) => !opts.onlyIds || opts.onlyIds.includes(row.id),
    );

    let purged = 0;
    for (const row of candidates) {
        try {
            await purgeMuxVideo(deps, row);
            purged++;
        } catch (err) {
            log.warn(
                { err, 'mux.video_id': row.id },
                'mux_videos.purge-superseded: row purge failed, will retry next run',
            );
        }
    }

    return { purged, total: candidates.length };
}
