/**
 * POST /render-job-create — ports the edge function of the same name
 * (Wave B #10). First route to call a `sql/functions/` DB function over
 * the pg pool, and first to use the RenderWorkerPort.
 *
 * The core (project read → `render_job_get_or_create` RPC → presigns →
 * fire-and-forget worker dispatch) lives in `services/renderJobs.ts`
 * since Wave B #9 — mux-video-create calls it in-process, replacing the
 * edge fn's service-role HTTP hop. This route keeps schema + auth +
 * editor check and delegates.
 *
 * AUTH SCOPE (user decision 2026-07-16): only the user-JWT path is
 * ported. The edge fn's service-role path (internal caller:
 * mux-video-create) is the in-process call above — the server never
 * implements service-role auth.
 *
 * `statusCallbackUrl` points at THIS server's /render-job-webhook
 * since Wave D #15 — built from PUBLIC_URL in app.ts (the edge fn's
 * RENDER_CALLBACK_URL_DEV split is dropped; server runs on the host).
 * In-flight jobs keep the URL they were dispatched with.
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
import { getOrCreateRenderJob } from '../services/renderJobs.js';

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

            const job = await getOrCreateRenderJob(app.deps, {
                projectId,
                userId,
                cloudVersion,
                statusCallbackUrl,
                log: req.log,
            });
            if (!job) {
                return reply.code(404).send({ error: 'Project not found' });
            }

            req.logCtx.set({ 'render.job_id': job.jobId });
            return job;
        },
    );
};
