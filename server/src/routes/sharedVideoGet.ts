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
 * Mux video lookup priority:
 *   1. Latest completed (highest cloud_version) with a playback id → completed
 *   2. Any pending → pending, with the backing render job's progress
 *   3. Otherwise (only failed rows, or none at all) → SELF-HEAL: publish
 *      the project's current version, subject to the attempt budget
 *
 * Kept for parity, flagged as a smell in the plan: 'canceled' rows are
 * silently ignored. (mux_videos.is_deleted no longer exists — removed
 * 2026-07-22; an older completed row now legally coexists with a newer
 * one until the daily purge, and cloud_version DESC picks the newest.)
 *
 * SELF-HEAL (step 3): a shared link whose video is missing — never
 * published, the publish call never fired, the row swept by the daily
 * purge — used to be permanently dead; only the owner re-opening the
 * share modal could fix it. The render is reproducible from
 * project_data, so ANY viewer's page load starts it, anonymous included.
 * Deliberately NOT gated on canShare (unlike mux-video-create): the link
 * is already public, so honour it. Bounded instead by the two-counter
 * attempt budget in services/sharedVideoPublish.ts — checked BEFORE the
 * publish call, because the upsert would otherwise flip the row back to
 * 'pending' and strand the page on "Preparing video..." forever.
 *
 * The loop closes on the mux row: a dispatch writes 'pending'
 * immediately, so the page's 5s poll takes branch 2 and never
 * re-dispatches; only a failed row re-enters branch 3, spending an
 * attempt each time.
 *
 * Progress: the pending row carries render_jobs.progress (0→1, the
 * worker's ~5s heartbeat) so an anonymous viewer sees a percentage.
 * Absent = queued and not yet reporting; 1 = rendered, waiting on the
 * Mux webhook. /render-job-get-status can't serve this — it's
 * editor-gated.
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
 * Response: { name, userName, status?, progress?, muxPlaybackId?, captions?, canEdit? }
 *           | 403 { error: 'auth_required' } | 404 { error: 'not_found' }
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import { SharedVideoGetRequestSchema, SharedVideoGetResponseSchema } from '@shared/api/projects';
import { canViewProject, getProjectIfEditor } from '../services/projectAccess.js';
import { getOutputCaptions, type ProjectTimelineShape } from '../services/projectCaptions.js';
import { MUX_RENDER_QUALITY } from '../services/muxUpload.js';
import {
    canAttemptPublish,
    publishProjectToMux,
    PUBLISH_COOLDOWN_SECONDS,
    type PublishAttemptState,
} from '../services/sharedVideoPublish.js';

/** VideoPage polls every 5s (12/min); 60/min per IP leaves headroom without inviting scraping. */
const RATE_LIMIT_PER_MINUTE = 60;

interface ProjectRow {
    id: string;
    name: string;
    owner_id: string;
    share_policy: string;
    cloud_version: number;
    upload_status: string;
    timeline: ProjectTimelineShape | null;
}

interface MuxVideoRow {
    status: string;
    mux_playback_id: string | null;
    render_progress: number | null;
}

interface PublishStateRow {
    mux_status: string | null;
    mux_error: string | null;
    mux_attempt: number | null;
    mux_recent: boolean | null;
    render_status: string | null;
    render_error: string | null;
    render_attempt_count: number | null;
    render_recent: boolean | null;
}

export interface SharedVideoGetRoutesOptions {
    /** This server's own /render-job-webhook URL, handed to the render worker */
    statusCallbackUrl?: string;
    /** NODE_ENV — outside production the failure reason is sent to the page */
    env?: string;
}

export const sharedVideoGetRoutes: FastifyPluginAsyncTypebox<SharedVideoGetRoutesOptions> = async (
    app,
    opts,
) => {
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
            const { statusCallbackUrl } = opts;
            const { slug } = req.body;
            req.logCtx.set({ 'project.slug': slug });

            /**
             * Why a video failed is an internal detail — a public viewer
             * gets the generic message and nothing else. Locally it is the
             * only thing you actually want to see, so outside production
             * the reason rides along and the page console.errors it. The
             * server logs it either way (mux.error on the canonical event).
             */
            const failed = <T extends object>(videoBase: T, reason: string | null) => {
                req.logCtx.set({
                    'mux.video_status': 'failed',
                    ...(reason && { 'mux.error': reason }),
                });
                return {
                    ...videoBase,
                    status: 'failed' as const,
                    ...(reason && opts.env !== 'production' && { failureReason: reason }),
                };
            };

            const { rows: projectRows } = await app.deps.db.query(
                `SELECT id, name, owner_id, share_policy, cloud_version, upload_status,
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
                // Latest row per status in one round trip, each carrying its
                // render job's progress. The render job is derived from
                // (project_id, cloud_version, quality) — the same join every
                // other reader uses (renderJobWebhook, both stale crons);
                // mux_videos.render_job_id exists and is backfilled but has
                // no writers yet ("Render/Mux simplification Step 2").
                app.deps.db.query(
                    `SELECT DISTINCT ON (mv.status)
                            mv.status, mv.mux_playback_id, rj.progress AS render_progress
                     FROM mux_videos mv
                     LEFT JOIN render_jobs rj
                            ON rj.project_id = mv.project_id
                           AND rj.cloud_version = mv.cloud_version
                           AND rj.quality = $2
                     WHERE mv.project_id = $1
                     ORDER BY mv.status, mv.cloud_version DESC`,
                    [project.id, MUX_RENDER_QUALITY],
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
            const pending = byStatus.get('pending');
            if (pending) {
                req.logCtx.set({ 'mux.video_status': 'pending' });
                return {
                    ...base,
                    status: 'pending' as const,
                    // Key omitted (not 0) while the job hasn't reported yet —
                    // the page shows "Preparing..." rather than a 0% bar
                    ...(pending.render_progress !== null && { progress: pending.render_progress }),
                };
            }

            // Nothing playable and nothing in flight — self-heal. The
            // project's CURRENT version is what gets published, so the
            // budget is read from that version's pair of rows.
            // Both cooldown comparisons are made HERE, against the same
            // NOW() that wrote the columns — never against the app clock.
            const { rows: stateRows } = await app.deps.db.query(
                `SELECT mv.status        AS mux_status,
                        mv.error         AS mux_error,
                        mv.attempt       AS mux_attempt,
                        mv.updated_at    > now() - make_interval(secs => $4) AS mux_recent,
                        rj.status        AS render_status,
                        rj.error         AS render_error,
                        rj.attempt_count AS render_attempt_count,
                        rj.updated_at    > now() - make_interval(secs => $4) AS render_recent
                 FROM (SELECT $1::uuid AS project_id, $2::int AS cloud_version) k
                 LEFT JOIN mux_videos mv
                        ON mv.project_id = k.project_id AND mv.cloud_version = k.cloud_version
                 LEFT JOIN render_jobs rj
                        ON rj.project_id = k.project_id AND rj.cloud_version = k.cloud_version
                       AND rj.quality = $3`,
                [project.id, project.cloud_version, MUX_RENDER_QUALITY, PUBLISH_COOLDOWN_SECONDS],
            );
            const state = stateRows[0] as PublishStateRow | undefined;

            // A completed row whose playback id hasn't landed yet (the
            // parity fallthrough above): the Mux webhook is still coming.
            if (state?.mux_status === 'completed') {
                req.logCtx.set({ 'mux.video_status': 'pending' });
                return { ...base, status: 'pending' as const };
            }

            // Media never finished uploading — a render would only fail.
            // Same answer as before this route could self-heal.
            if (project.upload_status !== 'ready') {
                return base;
            }

            const attemptState: PublishAttemptState = {
                muxAttempt: state?.mux_attempt ?? null,
                muxRecent: state?.mux_recent ?? null,
                renderAttemptCount: state?.render_attempt_count ?? null,
                renderRecent: state?.render_recent ?? null,
            };
            if (!canAttemptPublish(attemptState)) {
                req.logCtx.set({
                    'mux.attempt': attemptState.muxAttempt ?? 0,
                    'render.attempt_count': attemptState.renderAttemptCount ?? 0,
                });
                // The render's own error is the useful one; the mux row
                // usually just carries the cascade of it ('Render failed')
                const reason = state?.render_error
                    ?? state?.mux_error
                    ?? `render ${state?.render_status ?? 'job missing'}, no attempts left`;
                return failed(base, `${reason} (attempt budget spent, retry in up to 1h)`);
            }

            // Config is required at startup; this only fires in a test that
            // forgot to pass supabaseUrl (same guard as mux-video-create)
            if (!statusCallbackUrl) {
                throw new Error('sharedVideoGetRoutes: statusCallbackUrl not configured');
            }

            // Retrying after a failure: say what the last one died of, or
            // the reason is lost the moment the row is reset to pending
            const previousError = state?.render_error ?? state?.mux_error;
            if (previousError) {
                req.log.warn(
                    {
                        'project.id': project.id,
                        'mux.error': previousError,
                        'render.attempt_count': attemptState.renderAttemptCount ?? 0,
                    },
                    'shared video retrying after a failed publish',
                );
                req.logCtx.set({ 'mux.error': previousError });
            }

            try {
                const published = await publishProjectToMux(app.deps, {
                    projectId: project.id,
                    ownerId: project.owner_id,
                    cloudVersion: project.cloud_version,
                    statusCallbackUrl,
                    log: req.log,
                });
                req.logCtx.set({
                    'mux.video_status': 'pending',
                    'mux.auto_started': true,
                    'mux.attempt': (attemptState.muxAttempt ?? 0) + 1,
                    'render.attempt_count': (attemptState.renderAttemptCount ?? 0) + 1,
                    ...(published.renderJobId && { 'render.job_id': published.renderJobId }),
                });
                return { ...base, status: 'pending' as const };
            } catch (err) {
                // The publish service already marked the row failed; a page
                // load must not 500 over it — show the failure instead.
                req.log.warn({ err, 'project.id': project.id }, 'shared video auto-publish failed');
                req.logCtx.set({ 'mux.auto_started': true });
                return failed(base, err instanceof Error ? err.message : String(err));
            }
        },
    );
};
