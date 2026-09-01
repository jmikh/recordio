/**
 * POST /render-job-create — ports the edge function of the same name
 * (Wave B #10). First route to call a `sql/functions/` DB function over
 * the pg pool, and first to use the RenderWorkerPort.
 *
 * The core (project read → inline get-or-create → presigns →
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
 * Cloud renders are trial/Pro (billing revamp Step 1): the project
 * workspace's entitlements must have canBackgroundExport, else 403
 * subscription_required. (Replaces the edge-fn era's no-check state —
 * its "Pro subscription" comment described a gate that never existed.)
 *
 * Divergences (documented): schema 400s replace the per-field bodies;
 * cloudVersion must be an integer (the RPC param is INT — the edge fn
 * only checked non-null).
 *
 * High-res output (2K/4K) additionally requires can4k — enforced here
 * on top of canBackgroundExport; quality defaults to 1080p when absent.
 *
 * Request:  { projectId, cloudVersion, quality? }
 * Response: { jobId, status, renderStoragePath }
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import { getWorkspaceEntitlements } from '../services/entitlements.js';
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
                    // Mirrors ExportQuality (@shared/utils/exportQuality)
                    quality: Type.Optional(
                        Type.Union([
                            Type.Literal('480p'),
                            Type.Literal('720p'),
                            Type.Literal('1080p'),
                            Type.Literal('2K'),
                            Type.Literal('4K'),
                        ]),
                    ),
                }),
                response: {
                    200: Type.Object({
                        jobId: Type.String(),
                        status: Type.String(),
                        renderStoragePath: Type.Union([Type.String(), Type.Null()]),
                    }),
                    400: Type.Object({ error: Type.String() }, { additionalProperties: true }),
                    403: Type.Object({ error: Type.String() }),
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

            const { projectId, cloudVersion, quality = '1080p' } = req.body;
            const userId = req.user!.id;
            req.logCtx.set({ 'project.id': projectId });

            const access = await getProjectIfEditor(app.deps.db, projectId, userId);
            if (!access) {
                return reply.code(404).send({ error: 'Project not found or access denied' });
            }

            const entitlements = await getWorkspaceEntitlements(
                app.deps.db,
                app.deps.clock,
                access.workspace_id,
            );
            if (!entitlements.canBackgroundExport) {
                return reply.code(403).send({ error: 'subscription_required' });
            }
            if ((quality === '2K' || quality === '4K') && !entitlements.can4k) {
                return reply.code(403).send({ error: 'subscription_required' });
            }

            const job = await getOrCreateRenderJob(app.deps, {
                projectId,
                userId,
                cloudVersion,
                quality,
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
