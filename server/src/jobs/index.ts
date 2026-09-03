/**
 * Job registry (Wave C) — the definitions the scheduler runs in
 * production. Each entry adapts its job's natural counts into the
 * normalized JobRunResult the `job.run` event carries.
 *
 * Naming: `{table}.{verb}-{qualifier}` (user decision 2026-07-18) —
 * table exactly as in Postgres, closed verb set (purge/expire/
 * fail-stale; `send` added 2026-09-04 for the welcome job). Edge-fn
 * ancestry: projects.purge-deleted ← purge-deleted-projects;
 * mux_videos.purge-superseded ← mux-video-purge;
 * render_jobs.purge-superseded ← (new; replaces the broken
 * cron_render_purge); user_profiles.send-welcome ← (new; replaces the
 * caller-less POST /send-welcome-email route).
 */
import type { Deps } from '../deps.js';
import type { JobLogger, JobRunResult } from './types.js';
import { projectsPurgeDeleted, PROJECTS_PURGE_BATCH_LIMIT } from './projectsPurgeDeleted.js';
import { muxVideosPurgeSuperseded, MUX_PURGE_BATCH_LIMIT } from './muxVideosPurgeSuperseded.js';
import { renderJobsPurgeSuperseded, RENDER_PURGE_BATCH_LIMIT } from './renderJobsPurgeSuperseded.js';
import { userProfilesSendWelcome, WELCOME_SEND_BATCH_LIMIT } from './userProfilesSendWelcome.js';

export interface JobDefinition {
    name: string;
    period: 'daily' | 'hourly';
    /**
     * Daily jobs only: ticks earlier in the UTC day skip the job WITHOUT
     * claiming the period, so it runs on the first tick at/after this
     * hour (jobs without it keep running on the first tick after UTC
     * midnight). Deploy re-runs later the same day still happen — jobs
     * with a time gate must be no-op-on-re-run via their own DB marker.
     */
    notBeforeUtcHour?: number;
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
        name: 'user_profiles.send-welcome',
        period: 'daily',
        // 13:00 UTC = 8:00 EST (9:00 EDT) — a morning send, not the
        // post-midnight tick the purge jobs run on
        notBeforeUtcHour: 13,
        async run(deps, log) {
            const r = await userProfilesSendWelcome(deps, log);
            return {
                itemsProcessed: r.processed,
                itemsFailed: r.failed,
                batchFull: r.processed >= WELCOME_SEND_BATCH_LIMIT,
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
