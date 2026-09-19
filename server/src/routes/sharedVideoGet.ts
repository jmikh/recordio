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
 * Captions: a completed video also carries the project's caption
 * segments as output-time transcript lines (services/projectCaptions.ts)
 * so the page can render a clickable transcript. They come from the
 * LIVE project_data, not a per-render snapshot (none exists) — edits
 * made after publishing can drift from the rendered video until it is
 * re-published. Only the two timeline paths are read, never the whole
 * jsonb (userEvents can be megabytes).
 *
 * canEdit: a signed-in viewer with edit access (services/projectAccess
 * getProjectIfEditor — owner, edit grant, or workspace-edit share) gets
 * canEdit: true so the page can offer the editor. Independent of the Mux
 * status: a pending or failed publish is still editable.
 *
 * Request:  { slug }
 * Response: { name, userName, status?, muxPlaybackId?, captions?, canEdit? }
 *           | 403 { error: 'auth_required' } | 404 { error: 'not_found' }
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import { SharedVideoGetRequestSchema, SharedVideoGetResponseSchema } from '@shared/api/projects';
import { canViewProject, getProjectIfEditor } from '../services/projectAccess.js';
import { getOutputCaptions, type ProjectTimelineShape } from '../services/projectCaptions.js';

/** VideoPage polls every 5s (12/min); 60/min per IP leaves headroom without inviting scraping. */
const RATE_LIMIT_PER_MINUTE = 60;

interface ProjectRow {
    id: string;
    name: string;
    owner_id: string;
    share_policy: string;
    timeline: ProjectTimelineShape | null;
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
                body: SharedVideoGetRequestSchema,
                response: {
                    200: SharedVideoGetResponseSchema,
                    403: Type.Object({ error: Type.String() }),
                    404: Type.Object({ error: Type.String() }),
                },
            },
        },
        async (req, reply) => {
            const { slug } = req.body;
            req.logCtx.set({ 'project.slug': slug });

            const { rows: projectRows } = await app.deps.db.query(
                `SELECT id, name, owner_id, share_policy,
                        jsonb_build_object(
                            'captionSegments', project_data #> '{timeline,captionSegments}',
                            'outputWindows', project_data #> '{timeline,outputWindows}'
                        ) AS timeline
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
            const [owner, { rows: muxRows }, editorAccess] = await Promise.all([
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
                // Anonymous viewers skip the query entirely
                req.user ? getProjectIfEditor(app.deps.db, project.id, req.user.id) : null,
            ]);

            const meta = owner?.userMetadata ?? {};
            const userName = String(meta.full_name ?? meta.name ?? owner?.email ?? 'Unknown');
            const base = {
                name: project.name,
                userName,
                // Key omitted (not false) for viewers without edit access
                ...(editorAccess && { canEdit: true as const }),
            };

            const byStatus = new Map(
                (muxRows as MuxVideoRow[]).map((row) => [row.status, row]),
            );

            // Parity subtlety: a latest-completed row with a NULL playback id
            // falls through to the pending/failed checks, as in the edge fn.
            const completed = byStatus.get('completed');
            if (completed?.mux_playback_id) {
                req.logCtx.set({ 'mux.video_status': 'completed' });
                const captions = getOutputCaptions(project.timeline);
                return {
                    ...base,
                    status: 'completed' as const,
                    muxPlaybackId: completed.mux_playback_id,
                    // Key omitted (not []) when there is nothing to show
                    ...(captions.length > 0 && { captions }),
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
