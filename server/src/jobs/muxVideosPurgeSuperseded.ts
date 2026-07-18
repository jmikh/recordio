/**
 * Job `mux_videos.purge-superseded` (hourly) — ports the mux-video-purge
 * edge function (Wave C, parity loosened per plan).
 *
 * Candidates come from the `mux_video_purge_candidates()` DB function
 * (EXCLUSIVE to this job, no params, no auth.uid() → stays SQL over the
 * pool): rows below the highest COMPLETED version per project,
 * non-pending, LIMIT 50. Each is purged via the shared purgeMuxVideo
 * helper (Mux asset → render file → row, row last). Per-row catch — a
 * failed row is left for the next run.
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
        'SELECT id, mux_asset_id, render_storage_path FROM mux_video_purge_candidates()',
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
