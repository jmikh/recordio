/**
 * POST /shared-video-get — ports the edge function of the same name
 * (Wave A #2).
 *
 * OPTIONAL auth (share-access model): resolves a share slug to video
 * page data; read-only. 'public' serves anyone; other policies need a
 * signed-in viewer with access (owner, individual grant, or workspace
 * member for 'workspace') — anonymous callers get 403 auth_required so
 * the page can prompt sign-in; signed-in without access gets the same
 * 404 as a missing slug. Stricter per-route rate limit (the global
 * limit is a backstop).
 *
 * Mux video lookup priority (verbatim from the edge function):
 *   1. Latest completed (highest cloud_version) with a playback id → completed
 *   2. Any pending → pending
 *   3. Any failed → failed
 *   4. Otherwise → no mux data (frontend shows "Could not find video")
 *
 * Kept for parity, flagged as a smell in the plan: 'canceled' rows are
 * silently ignored. (mux_videos.is_deleted no longer exists — removed
 * 2026-07-22; an older completed row now legally coexists with a newer
 * one until the daily purge, and cloud_version DESC picks the newest.)
 *
 * Request:  { slug }
 * Response: { name, userName, status?, muxPlaybackId? }
 *           | 403 { error: 'auth_required' } | 404 { error: 'not_found' }
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import { canViewProject } from '../services/projectAccess.js';

/** VideoPage polls every 5s (12/min); 60/min per IP leaves headroom without inviting scraping. */
const RATE_LIMIT_PER_MINUTE = 60;

interface ProjectRow {
    id: string;
    name: string;
    owner_id: string;
    share_policy: string;
}

interface MuxVideoRow {
    status: string;
    mux_playback_id: string | null;
}

export const sharedVideoGetRoutes: FastifyPluginAsyncTypebox = async (app) => {
    app.post(
        '/shared-video-get',
        {
            preHandler: app.optionalUser,
            config: {
                rateLimit: { max: RATE_LIMIT_PER_MINUTE, timeWindow: '1 minute' },
            },
            schema: {
                body: Type.Object({
                    slug: Type.String({ minLength: 1 }),
                }),
                response: {
                    200: Type.Object({
                        name: Type.String(),
                        userName: Type.String(),
                        status: Type.Optional(
                            Type.Union([
                                Type.Literal('completed'),
                                Type.Literal('pending'),
                                Type.Literal('failed'),
                            ]),
                        ),
                        muxPlaybackId: Type.Optional(Type.String()),
                    }),
                    403: Type.Object({ error: Type.String() }),
                    404: Type.Object({ error: Type.String() }),
                },
            },
        },
        async (req, reply) => {
            const { slug } = req.body;
            req.logCtx.set({ 'project.slug': slug });

            const { rows: projectRows } = await app.deps.db.query(
                `SELECT id, name, owner_id, share_policy
                 FROM projects
                 WHERE slug = $1 AND deleted_at IS NULL
                 LIMIT 1`,
                [slug],
            );
            const project = projectRows[0] as ProjectRow | undefined;

            if (!project) {
                return reply.code(404).send({ error: 'not_found' });
            }
            if (project.share_policy !== 'public') {
                // Anonymous viewers may simply need to sign in (workspace
                // or individually-shared videos) — tell the page so
                if (!req.user) {
                    return reply.code(403).send({ error: 'auth_required' });
                }
                if (!await canViewProject(app.deps.db, project.id, req.user.id)) {
                    return reply.code(404).send({ error: 'not_found' });
                }
            }
            req.logCtx.set({ 'project.id': project.id });

            // Edge-function parity: any owner-lookup failure degrades to
            // 'Unknown' rather than erroring — but surface it in the
            // canonical event so a broken adapter doesn't hide silently.
            const [owner, { rows: muxRows }] = await Promise.all([
                app.deps.supabaseApi.getUserById(project.owner_id).catch(() => {
                    req.logCtx.set({ error_type: 'SupabaseApiUnavailable' });
                    return null;
                }),
                // Latest row per status in one round trip; the edge function
                // made up to three sequential queries for the same answer.
                app.deps.db.query(
                    `SELECT DISTINCT ON (status) status, mux_playback_id
                     FROM mux_videos
                     WHERE project_id = $1
                     ORDER BY status, cloud_version DESC`,
                    [project.id],
                ),
            ]);

            const meta = owner?.userMetadata ?? {};
            const userName = String(meta.full_name ?? meta.name ?? owner?.email ?? 'Unknown');
            const base = { name: project.name, userName };

            const byStatus = new Map(
                (muxRows as MuxVideoRow[]).map((row) => [row.status, row]),
            );

            // Parity subtlety: a latest-completed row with a NULL playback id
            // falls through to the pending/failed checks, as in the edge fn.
            const completed = byStatus.get('completed');
            if (completed?.mux_playback_id) {
                req.logCtx.set({ 'mux.video_status': 'completed' });
                return {
                    ...base,
                    status: 'completed' as const,
                    muxPlaybackId: completed.mux_playback_id,
                };
            }
            if (byStatus.has('pending')) {
                req.logCtx.set({ 'mux.video_status': 'pending' });
                return { ...base, status: 'pending' as const };
            }
            if (byStatus.has('failed')) {
                req.logCtx.set({ 'mux.video_status': 'failed' });
                return { ...base, status: 'failed' as const };
            }
            return base;
        },
    );
};
