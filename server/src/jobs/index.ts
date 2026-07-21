/**
 * Job registry (Wave C) — the definitions the scheduler runs in
 * production. Each entry adapts its job's natural counts into the
 * normalized JobRunResult the `job.completed` event carries.
 *
 * Naming: `{table}.{verb}-{qualifier}` (user decision 2026-07-18) —
 * table exactly as in Postgres, closed verb set (purge/expire/
 * fail-stale). Edge-fn ancestry: projects.purge-deleted ←
 * purge-deleted-projects; mux_videos.purge-superseded ←
 * mux-video-purge; render_jobs.purge-superseded ← (new; replaces the
 * broken cron_render_purge).
 */
import type { Deps } from '../deps.js';
import type { JobLogger, JobRunResult } from './types.js';
import { projectsPurgeDeleted, PROJECTS_PURGE_BATCH_LIMIT } from './projectsPurgeDeleted.js';
import { muxVideosPurgeSuperseded, MUX_PURGE_BATCH_LIMIT } from './muxVideosPurgeSuperseded.js';
import { renderJobsPurgeSuperseded, RENDER_PURGE_BATCH_LIMIT } from './renderJobsPurgeSuperseded.js';

export interface JobDefinition {
    name: string;
    period: 'daily' | 'hourly';
    run(deps: Deps, log: JobLogger): Promise<JobRunResult>;
}

export const jobs: JobDefinition[] = [
    {
        name: 'projects.purge-deleted',
        period: 'daily',
        async run(deps, log) {
            const r = await projectsPurgeDeleted(deps, log);
            return {
                itemsProcessed: r.processed,
                itemsFailed: r.failed,
                batchFull: r.processed >= PROJECTS_PURGE_BATCH_LIMIT,
            };
        },
    },
    {
        name: 'mux_videos.purge-superseded',
        period: 'daily',
        async run(deps, log) {
            const r = await muxVideosPurgeSuperseded(deps, log);
            return {
                itemsProcessed: r.total,
                itemsFailed: r.total - r.purged,
                batchFull: r.total >= MUX_PURGE_BATCH_LIMIT,
            };
        },
    },
    {
        name: 'render_jobs.purge-superseded',
        period: 'daily',
        async run(deps, log) {
            const r = await renderJobsPurgeSuperseded(deps, log);
            return {
                itemsProcessed: r.total,
                itemsFailed: r.total - r.purged,
                batchFull: r.total >= RENDER_PURGE_BATCH_LIMIT,
            };
        },
    },
];
