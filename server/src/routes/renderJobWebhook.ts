/**
 * POST /render-job-webhook — ports the `render-job-hook` edge function
 * (Wave D #15; the server route says "webhook", user decision
 * 2026-07-21 — the URL is ours, only the edge fn keeps "hook").
 *
 * Called by the render worker (~15 s heartbeats with progress, then a
 * terminal completed/failed). FIRST NON-JWT ROUTE: auth is the shared
 * `RENDER_SECRET` bearer, exact match, checked in onRequest — BEFORE
 * schema validation, matching the edge fn's check order (plain string
 * compare, parity; the secret is high-entropy).
 *
 * Flow (parity): read job → missing 404 → non-pending → answer
 * `{ ok, cancel: true }` (the worker polls this to abort; NO writes) →
 * one UPDATE with progress/durations (`start_duration_s` computed on
 * the first callback; completed also stamps total_duration_s +
 * progress 1) → terminal states run the inline complete-and-cascade
 * CTE (pending-only guard; failed/canceled cascade to pending
 * mux_videos — the stale-jobs cron inlines the same logic since the
 * 2026-07-25 sweep) → on completed with a path,
 * a pending mux_video for the same (project_id, cloud_version) is
 * uploaded to Mux via services/muxUpload (built shared for exactly
 * this in part12). A failed Mux upload still answers 200 — uploadToMux
 * already marked the row failed; the worker did its job.
 *
 * A worker-reported failure is logged as an error (the edge fn sent it
 * to Sentry via captureException) — the request itself succeeds, so
 * this must not throw; logs are the one place to look.
 *
 * Request:  { jobId, status?, progress?, error?, download_duration_s?,
 *             render_duration_s?, upload_duration_s? }
 * Response: { ok: true, cancel: boolean }
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import { logEvent } from '../logging.js';
import { uploadToMux, MUX_RENDER_QUALITY } from '../services/muxUpload.js';

interface JobRow {
    status: string;
    created_at: Date;
    start_duration_s: number | null;
    project_id: string;
    cloud_version: number;
    render_storage_path: string | null;
    quality: string;
}

export interface RenderJobWebhookRoutesOptions {
    /** Shared bearer secret the render worker sends (RENDER_SECRET) */
    renderSecret?: string;
}

export const renderJobWebhookRoutes: FastifyPluginAsyncTypebox<RenderJobWebhookRoutesOptions> = async (
    app,
    opts,
) => {
    app.post(
        '/render-job-webhook',
        {
            // Auth precedes body validation (edge-fn check order): a bad
            // body with a bad secret must 401, not 400
            onRequest: async (req, reply) => {
                // Config is required at startup; this only fires in a test
                // that forgot to pass renderSecret
                if (!opts.renderSecret) {
                    throw new Error('renderJobWebhookRoutes: renderSecret not configured');
                }
                if (req.headers.authorization !== `Bearer ${opts.renderSecret}`) {
                    return reply.code(401).send({ error: 'Unauthorized' });
                }
            },
            schema: {
                body: Type.Object({
                    jobId: Type.String({ minLength: 1 }),
                    status: Type.Optional(Type.String()),
                    // Numbers under Ajv coercion (documented caveat, as
                    // elsewhere) — the worker sends real numbers
                    progress: Type.Optional(Type.Number()),
                    error: Type.Optional(Type.String()),
                    download_duration_s: Type.Optional(Type.Number()),
                    render_duration_s: Type.Optional(Type.Number()),
                    upload_duration_s: Type.Optional(Type.Number()),
                }),
                response: {
                    200: Type.Object({
                        ok: Type.Literal(true),
                        cancel: Type.Boolean(),
                    }),
                    400: Type.Object({ error: Type.String() }, { additionalProperties: true }),
                    401: Type.Object({ error: Type.String() }),
                    404: Type.Object({ error: Type.String() }),
                    500: Type.Object({ error: Type.String() }, { additionalProperties: true }),
                },
            },
        },
        async (req, reply) => {
            const {
                jobId,
                status,
                progress,
                error: errorMsg,
                download_duration_s,
                render_duration_s,
                upload_duration_s,
            } = req.body;
            req.logCtx.set({ 'render.job_id': jobId });

            const { rows } = await app.deps.db.query(
                `SELECT status, created_at, start_duration_s, project_id, cloud_version, render_storage_path, quality
                 FROM render_jobs WHERE id = $1`,
                [jobId],
            );
            const job = rows[0] as JobRow | undefined;
            if (!job) {
                return reply.code(404).send({ error: 'Job not found' });
            }
            req.logCtx.set({ 'project.id': job.project_id });

            // Not pending anymore — signal the worker to abort. No writes.
            if (job.status !== 'pending') {
                return { ok: true as const, cancel: true };
            }

            const now = app.deps.clock.now();
            // Keyed object, NOT an array of SET fragments: the worker's
            // final callback sends progress AND status together, and the
            // completed branch overwrites progress — duplicate column
            // assignments in one UPDATE are a Postgres error (found in
            // prod 2026-07-21; the edge fn's object semantics never
            // collided)
            const updates: Record<string, unknown> = { updated_at: now.toISOString() };
            if (progress !== undefined) updates.progress = progress;
            if (download_duration_s !== undefined) updates.download_duration_s = download_duration_s;
            if (render_duration_s !== undefined) updates.render_duration_s = render_duration_s;
            if (upload_duration_s !== undefined) updates.upload_duration_s = upload_duration_s;
            // Dispatch + cold-start latency, computed on the first callback
            if (job.start_duration_s === null) {
                updates.start_duration_s = (now.getTime() - new Date(job.created_at).getTime()) / 1000;
            }
            if (status === 'completed') {
                updates.total_duration_s = (now.getTime() - new Date(job.created_at).getTime()) / 1000;
                updates.progress = 1;
            }

            const columns = Object.keys(updates);
            await app.deps.db.query(
                `UPDATE render_jobs SET ${columns.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1`,
                [jobId, ...columns.map((c) => updates[c])],
            );

            // Terminal state — inline port of render_job_complete (SQL fn
            // graveyarded 2026-07-25): one data-modifying CTE guards
            // pending-only and cascades failed/canceled to pending
            // mux_videos atomically (both writes in one statement)
            if (status === 'completed' || status === 'failed') {
                if (status === 'failed') {
                    // Worker-reported failure: a domain event, not a request
                    // error — log it, never throw (the hook itself succeeded)
                    req.log.error(
                        { 'render.job_id': jobId, 'project.id': job.project_id, error: errorMsg },
                        'render worker reported job failure',
                    );
                }
                // $4 gates the cascade to the Mux quality only: a pending
                // mux_video tracks its own MUX_RENDER_QUALITY render, so a
                // failed render at another quality (e.g. a 1080p download
                // export for the same version) must not fail it. The job's
                // own status update is unconditional (data-modifying CTEs
                // always run to completion regardless of the outer WHERE).
                await app.deps.db.query(
                    `WITH job AS (
                        UPDATE render_jobs
                        SET status = $2, error = $3, updated_at = NOW()
                        WHERE id = $1 AND status = 'pending'
                        RETURNING project_id, cloud_version
                    )
                    UPDATE mux_videos mv
                    SET status = 'failed',
                        error = COALESCE($3, 'Render ' || $2),
                        updated_at = NOW()
                    FROM job
                    WHERE $2 IN ('failed', 'canceled')
                      AND $4::boolean
                      AND mv.project_id = job.project_id
                      AND mv.cloud_version = job.cloud_version
                      AND mv.status = 'pending'`,
                    [jobId, status, errorMsg || null, job.quality === MUX_RENDER_QUALITY],
                );

                if (status === 'completed') {
                    logEvent(req.log, 'render_job.completed', {
                        'render.job_id': jobId,
                        'project.id': job.project_id,
                    });

                    // Render done → upload to Mux if a pending mux_video
                    // awaits this version. Only the Mux quality (1440p)
                    // feeds Mux: a completed render at another quality (e.g.
                    // a 1080p download export for the same version) must not
                    // hijack the pending mux_video — mux-video-create always
                    // enqueues its own MUX_RENDER_QUALITY render.
                    if (job.quality === MUX_RENDER_QUALITY && job.render_storage_path) {
                        const { rows: muxRows } = await app.deps.db.query(
                            `SELECT id FROM mux_videos
                             WHERE project_id = $1 AND cloud_version = $2 AND status = 'pending'
                             LIMIT 1`,
                            [job.project_id, job.cloud_version],
                        );
                        const pendingMux = muxRows[0] as { id: string } | undefined;
                        if (pendingMux) {
                            const upload = await uploadToMux(app.deps, {
                                muxVideoId: pendingMux.id,
                                renderStoragePath: job.render_storage_path,
                            });
                            if (upload.success) {
                                req.logCtx.set({
                                    'mux.asset_id': upload.muxAssetId,
                                    'mux.video_status': 'pending',
                                });
                            } else {
                                // uploadToMux already marked the row failed;
                                // 200 keeps the worker happy (parity)
                                req.log.error(
                                    { 'render.job_id': jobId, error: upload.error },
                                    'mux upload failed after render completion',
                                );
                            }
                        }
                    }
                }
            }

            return { ok: true as const, cancel: false };
        },
    );
};
