/**
 * POST /mux-video-create — ports the edge function of the same name
 * (Wave B #9, last plain Wave B route). First route on the MuxPort.
 *
 * Resolves a mux_video row for (projectId, cloudVersion) via an inline
 * upsert on the (project_id, cloud_version) unique index — atomic
 * cache-hit / dedup / retry / insert in one statement (was the
 * mux_video_get_or_create SQL fn until the 2026-07-25 sweep). On a
 * new/retried row: get-or-create the
 * render job IN-PROCESS via `services/renderJobs.ts` (the edge fn made
 * this hop over HTTP with the service-role key), and if the render is
 * already completed, upload it to Mux (`services/muxUpload.ts`). Both
 * kicked-off paths answer `{ status: 'pending' }` — the Mux webhook
 * (Wave D) completes the row.
 *
 * ATTRIBUTION (edge-fn parity, pinned by test): BOTH RPCs get the
 * project OWNER's id, not the caller's — an explicit editor triggering
 * this creates mux_videos/render_jobs rows and a render path under the
 * OWNER's prefix, unlike the direct /render-job-create route.
 *
 * Failure contract (parity, pinned): any failure in the render step
 * marks the mux_video `failed` with error `Render dispatch failed`
 * before rethrowing — the row must not sit pending forever. A Mux
 * upload failure is marked inside uploadToMux with the mapped error
 * string; the route then 500s.
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
import { getOrCreateRenderJob, type RenderJobResolution } from '../services/renderJobs.js';
import { markMuxVideoFailed, uploadToMux } from '../services/muxUpload.js';

interface MuxVideoResolution {
    mux_video_id: string;
    status: string;
    is_new: boolean;
}

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

            const ownerId = access.owner_id;

            // Inline port of mux_video_get_or_create (SQL fn graveyarded
            // 2026-07-25) as a true upsert on the (project_id,
            // cloud_version) unique index: insert → is_new; conflict with
            // a failed/canceled row → RESET to pending, is_new; conflict
            // with completed/pending → the DO UPDATE's WHERE skips it and
            // the fallback SELECT returns the untouched row, is_new false.
            const { rows } = await app.deps.db.query(
                `WITH upserted AS (
                    INSERT INTO mux_videos (project_id, user_id, cloud_version, status)
                    VALUES ($1, $2, $3, 'pending')
                    ON CONFLICT (project_id, cloud_version) DO UPDATE
                        SET status = 'pending',
                            error = NULL,
                            mux_asset_id = NULL,
                            mux_playback_id = NULL,
                            render_storage_path = NULL,
                            updated_at = NOW()
                        WHERE mux_videos.status NOT IN ('completed', 'pending')
                    RETURNING id, status, TRUE AS is_new
                )
                SELECT u.id AS mux_video_id, u.status, u.is_new FROM upserted u
                UNION ALL
                SELECT mv.id, mv.status, FALSE
                FROM mux_videos mv
                WHERE mv.project_id = $1 AND mv.cloud_version = $3
                  AND NOT EXISTS (SELECT 1 FROM upserted)`,
                [projectId, ownerId, cloudVersion],
            );
            const result = rows[0] as MuxVideoResolution | undefined;
            if (!result) throw new Error('mux video get-or-create returned no row');

            const muxVideoId = result.mux_video_id;
            req.logCtx.set({ 'mux.video_status': result.status });

            // Existing row — completed or in-flight; return as-is
            if (!result.is_new) {
                return { status: result.status, muxVideoId };
            }

            // New/retried row: get-or-create the render job (in-process).
            // On failure: mark the mux_video failed before rethrowing so
            // the row doesn't sit in 'pending' forever.
            let render: RenderJobResolution;
            try {
                const resolution = await getOrCreateRenderJob(app.deps, {
                    projectId,
                    userId: ownerId,
                    cloudVersion,
                    statusCallbackUrl,
                    log: req.log,
                });
                // Only reachable via a project delete mid-request (the
                // editor check above just saw it)
                if (!resolution) throw new Error('Project not found during render job creation');
                render = resolution;
            } catch (err) {
                await markMuxVideoFailed(app.deps, muxVideoId, 'Render dispatch failed');
                throw err;
            }

            req.logCtx.set({ 'render.job_id': render.jobId });

            // Render already done (cache hit) — upload to Mux now; otherwise
            // the worker's render-job-hook callback uploads on completion
            if (render.status === 'completed' && render.renderStoragePath) {
                const upload = await uploadToMux(app.deps, {
                    muxVideoId,
                    renderStoragePath: render.renderStoragePath,
                });
                if (!upload.success) {
                    throw new Error(`Mux upload failed: ${upload.error ?? 'unknown'}`);
                }
                req.logCtx.set({ 'mux.asset_id': upload.muxAssetId });
            }

            return { status: 'pending', muxVideoId };
        },
    );
};
