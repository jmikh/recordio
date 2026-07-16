/**
 * POST /shared-video-get — ports the edge function of the same name
 * (Wave A #2).
 *
 * PUBLIC — no auth. Resolves a share slug to video page data; read-only.
 * Stricter per-route rate limit instead (the global limit is a backstop).
 *
 * Mux video lookup priority (verbatim from the edge function):
 *   1. Latest completed (highest cloud_version) with a playback id → completed
 *   2. Any pending → pending
 *   3. Any failed → failed
 *   4. Otherwise → no mux data (frontend shows "Could not find video")
 *
 * Kept for parity, flagged as smells in the plan: the completed lookup does
 * NOT filter is_deleted (despite the edge function's comment claiming it
 * does), and 'canceled' rows are silently ignored.
 *
 * Request:  { slug }
 * Response: { name, userName, status?, muxPlaybackId? }
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';

/** VideoPage polls every 5s (12/min); 60/min per IP leaves headroom without inviting scraping. */
const RATE_LIMIT_PER_MINUTE = 60;

interface ProjectRow {
    id: string;
    name: string;
    owner_id: string;
    share_policy: string | null;
}

interface MuxVideoRow {
    status: string;
    mux_playback_id: string | null;
}

export const sharedVideoGetRoutes: FastifyPluginAsyncTypebox = async (app) => {
    app.post(
        '/shared-video-get',
        {
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

            if (!project || project.share_policy !== 'public') {
                return reply.code(404).send({ error: 'not_found' });
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
