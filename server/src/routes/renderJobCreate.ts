/**
 * POST /render-job-create — ports the edge function of the same name
 * (Wave B #10). First route to call a `sql/functions/` DB function over
 * the pg pool, and first to use the RenderWorkerPort.
 *
 * Resolves a render job for (projectId, cloudVersion) via the
 * `render_job_get_or_create` RPC — atomic cache-hit / dedup / retry /
 * insert; it stays SQL on purpose (it takes explicit $user_id, no
 * auth.uid(), so it works over the pool, and reimplementing it in TS
 * would lose the atomicity). On a new/retried job: presign GETs for the
 * project's media + a PUT for the output path, then dispatch to the
 * render worker FIRE-AND-FORGET (not awaited; failures are logged only —
 * the stale-job cron is the safety net, edge-fn parity).
 *
 * AUTH SCOPE (user decision 2026-07-16): only the user-JWT path is
 * ported. The edge fn's service-role path (internal caller:
 * mux-video-create) keeps hitting the EDGE function until Wave B #9
 * migrates, then becomes an in-process call.
 *
 * `statusCallbackUrl` stays the Supabase render-job-hook URL until
 * Wave D (per plan) — built from SUPABASE_URL in app.ts; the edge fn's
 * RENDER_CALLBACK_URL_DEV split is dropped (server runs on the host).
 *
 * Divergences (documented): schema 400s replace the per-field bodies;
 * cloudVersion must be an integer (the RPC param is INT — the edge fn
 * only checked non-null); the "Pro subscription" comment in the edge fn
 * is stale — there is no such check, any project editor can render.
 *
 * Request:  { projectId, cloudVersion }
 * Response: { jobId, status, renderStoragePath }
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import { getProjectIfEditor } from '../services/projectAccess.js';
import { getProjectMediaPaths } from '../services/projectMedia.js';

interface JobResolution {
    job_id: string;
    status: string;
    is_new: boolean;
    render_storage_path: string | null;
}

export interface RenderJobCreateRoutesOptions {
    /** The Supabase render-job-hook URL handed to the worker (until Wave D) */
    statusCallbackUrl?: string;
}

export const renderJobCreateRoutes: FastifyPluginAsyncTypebox<RenderJobCreateRoutesOptions> = async (
    app,
    opts,
) => {
    app.post(
        '/render-job-create',
        {
            preHandler: app.requireUser,
            schema: {
                body: Type.Object({
                    projectId: Type.String({ minLength: 1 }),
                    // minimum 1: cloud_version starts at 1, and Ajv coercion
                    // would otherwise turn a null body value into 0
                    cloudVersion: Type.Integer({ minimum: 1 }),
                }),
                response: {
                    200: Type.Object({
                        jobId: Type.String(),
                        status: Type.String(),
                        renderStoragePath: Type.Union([Type.String(), Type.Null()]),
                    }),
                    400: Type.Object({ error: Type.String() }, { additionalProperties: true }),
                    404: Type.Object({ error: Type.String() }),
                    500: Type.Object({ error: Type.String() }, { additionalProperties: true }),
                },
            },
        },
        async (req, reply) => {
            // Config is required at startup; this only fires in a test that
            // forgot to pass supabaseUrl (same guard as stripe-checkout)
            const { statusCallbackUrl } = opts;
            if (!statusCallbackUrl) {
                throw new Error('renderJobCreateRoutes: statusCallbackUrl not configured');
            }

            const { projectId, cloudVersion } = req.body;
            const userId = req.user!.id;
            req.logCtx.set({ 'project.id': projectId });

            const access = await getProjectIfEditor(app.deps.db, projectId, userId);
            if (!access) {
                return reply.code(404).send({ error: 'Project not found or access denied' });
            }

            // Kept as a second query for edge-fn parity (its admin re-read);
            // reachable-miss only via a delete between the two queries
            const { rows: projectRows } = await app.deps.db.query(
                `SELECT name, project_data FROM projects
                 WHERE id = $1 AND deleted_at IS NULL`,
                [projectId],
            );
            const project = projectRows[0] as
                | { name: string; project_data: unknown }
                | undefined;
            if (!project) {
                return reply.code(404).send({ error: 'Project not found' });
            }

            const { rows: jobRows } = await app.deps.db.query(
                'SELECT job_id, status, is_new, render_storage_path FROM render_job_get_or_create($1, $2, $3)',
                [projectId, userId, cloudVersion],
            );
            const job = jobRows[0] as JobResolution | undefined;
            if (!job) throw new Error('render_job_get_or_create returned no row');

            req.logCtx.set({ 'render.job_id': job.job_id });

            // Cache hit or dedup — no presigning, no dispatch
            if (!job.is_new) {
                return {
                    jobId: job.job_id,
                    status: job.status,
                    renderStoragePath: job.render_storage_path,
                };
            }

            // New (or retried) job: presign media downloads + output upload
            const mediaUrls: Record<string, string> = {};
            await Promise.all(
                getProjectMediaPaths(project.project_data).map(async (entry) => {
                    mediaUrls[entry.storagePath] = await app.deps.s3.presignDownload(
                        entry.storagePath,
                        3600,
                    );
                }),
            );
            const uploadUrl = await app.deps.s3.presignUpload(job.render_storage_path!, 3600);

            // Fire-and-forget (edge-fn parity): the response never waits on
            // the worker; a failed dispatch is caught by the stale-job cron
            void app.deps.renderWorker
                .submitJob({
                    jobId: job.job_id,
                    projectData: project.project_data,
                    projectName: project.name,
                    quality: '1080p',
                    mediaUrls,
                    uploadUrl,
                    statusCallbackUrl,
                })
                .catch((err: unknown) => {
                    req.log.warn(
                        { err, 'render.job_id': job.job_id },
                        'render worker dispatch failed',
                    );
                });

            return {
                jobId: job.job_id,
                status: 'pending',
                renderStoragePath: job.render_storage_path,
            };
        },
    );
};
