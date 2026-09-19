/**
 * POST /mux-video-create — ports the edge function of the same name
 * (Wave B #9, last plain Wave B route). First route on the MuxPort.
 *
 * This route is now the AUTHENTICATED front door to
 * `services/sharedVideoPublish.ts` — it owns the editor + entitlement
 * checks and delegates the upsert / render dispatch / Mux upload chain
 * (see that file for the semantics, attribution and failure contract).
 * shared-video-get calls the same service to self-heal a shared link
 * whose video is missing, which is why the chain lives outside the route.
 *
 * Share plumbing is trial/Pro (billing revamp Step 1): the project
 * workspace's entitlements must have canShare, else 403
 * subscription_required — gated with the share flag because this route
 * only serves already-shared projects.
 *
 * Divergences (documented): schema 400s replace the edge fn's
 * `Missing projectId` / `Missing cloudVersion` bodies; cloudVersion
 * must be an integer >= 1 (Ajv coercion — same reasoning as
 * render-job-create).
 *
 * Request:  { projectId, cloudVersion }
 * Response: { status, muxVideoId }
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import { getWorkspaceEntitlements } from '../services/entitlements.js';
import { getProjectIfEditor } from '../services/projectAccess.js';
import { publishProjectToMux } from '../services/sharedVideoPublish.js';

export interface MuxVideoCreateRoutesOptions {
    /** The Supabase render-job-hook URL handed to the worker (until Wave D) */
    statusCallbackUrl?: string;
}

export const muxVideoCreateRoutes: FastifyPluginAsyncTypebox<MuxVideoCreateRoutesOptions> = async (
    app,
    opts,
) => {
    app.post(
        '/mux-video-create',
        {
            preHandler: app.requireUser,
            schema: {
                body: Type.Object({
                    projectId: Type.String({ minLength: 1 }),
                    cloudVersion: Type.Integer({ minimum: 1 }),
                }),
                response: {
                    200: Type.Object({
                        status: Type.String(),
                        muxVideoId: Type.String(),
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
            // forgot to pass supabaseUrl (same guard as render-job-create)
            const { statusCallbackUrl } = opts;
            if (!statusCallbackUrl) {
                throw new Error('muxVideoCreateRoutes: statusCallbackUrl not configured');
            }

            const { projectId, cloudVersion } = req.body;
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
            if (!entitlements.canShare) {
                return reply.code(403).send({ error: 'subscription_required' });
            }

            const result = await publishProjectToMux(app.deps, {
                projectId,
                ownerId: access.owner_id,
                cloudVersion,
                statusCallbackUrl,
                log: req.log,
            });

            req.logCtx.set({
                'mux.video_status': result.status,
                ...(result.renderJobId && { 'render.job_id': result.renderJobId }),
                ...(result.muxAssetId && { 'mux.asset_id': result.muxAssetId }),
            });

            return { status: result.status, muxVideoId: result.muxVideoId };
        },
    );
};
