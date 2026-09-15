/**
 * POST /shared-screenshot-get — the public screenshot view page's data
 * (plans/screenshots; sibling of shared-video-get).
 *
 * OPTIONAL auth (share-access model): resolves a share slug; read-only.
 * 'public' serves anyone; other policies need a signed-in viewer with
 * access (owner, or workspace member for 'workspace') — anonymous
 * callers get 403 auth_required so the page can prompt sign-in;
 * signed-in without access gets the same 404 as a missing slug.
 * Stricter per-route rate limit (the global limit is a backstop).
 *
 * The page gets a presigned URL of the FLATTENED RENDER only — never the
 * raw source (blurred regions must stay hidden). `imageUrl` is null when
 * the owner has not published a render yet; `stale` flags a render that
 * predates the latest edit (the editor re-publishes after saves).
 *
 * Request:  { slug }
 * Response: { name, userName, widthPx, heightPx, imageUrl, stale }
 *           | 403 { error: 'auth_required' } | 404 { error: 'not_found' }
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import { SharedScreenshotGetRequestSchema, SharedScreenshotGetResponseSchema } from '@shared/api/screenshots';
import { canViewScreenshot } from '../services/screenshotAccess.js';

const RATE_LIMIT_PER_MINUTE = 60;
const IMAGE_URL_TTL_SECONDS = 3600;

interface ScreenshotRow {
    id: string;
    name: string;
    owner_id: string;
    share_policy: string;
    width_px: number;
    height_px: number;
    cloud_version: number;
    render_storage_path: string | null;
    render_cloud_version: number | null;
}

export const sharedScreenshotGetRoutes: FastifyPluginAsyncTypebox = async (app) => {
    app.post(
        '/shared-screenshot-get',
        {
            preHandler: app.optionalUser,
            config: {
                rateLimit: { max: RATE_LIMIT_PER_MINUTE, timeWindow: '1 minute' },
            },
            schema: {
                body: SharedScreenshotGetRequestSchema,
                response: {
                    200: SharedScreenshotGetResponseSchema,
                    403: Type.Object({ error: Type.String() }),
                    404: Type.Object({ error: Type.String() }),
                },
            },
        },
        async (req, reply) => {
            const { slug } = req.body;
            req.logCtx.set({ 'screenshot.slug': slug });

            const { rows } = await app.deps.db.query(
                `SELECT id, name, owner_id, share_policy, width_px, height_px,
                        cloud_version, render_storage_path, render_cloud_version
                 FROM screenshots
                 WHERE slug = $1 AND deleted_at IS NULL
                 LIMIT 1`,
                [slug],
            );
            const screenshot = rows[0] as ScreenshotRow | undefined;

            if (!screenshot) {
                return reply.code(404).send({ error: 'not_found' });
            }
            if (screenshot.share_policy !== 'public') {
                if (!req.user) {
                    return reply.code(403).send({ error: 'auth_required' });
                }
                if (!await canViewScreenshot(app.deps.db, screenshot.id, req.user.id)) {
                    return reply.code(404).send({ error: 'not_found' });
                }
            }
            req.logCtx.set({ 'screenshot.id': screenshot.id });

            const [owner, imageUrl] = await Promise.all([
                app.deps.supabaseApi.getUserById(screenshot.owner_id).catch(() => {
                    req.logCtx.set({ error_type: 'SupabaseApiUnavailable' });
                    return null;
                }),
                screenshot.render_storage_path
                    ? app.deps.s3.presignDownload(screenshot.render_storage_path, IMAGE_URL_TTL_SECONDS)
                    : Promise.resolve(null),
            ]);

            const meta = owner?.userMetadata ?? {};
            const userName = String(meta.full_name ?? meta.name ?? owner?.email ?? 'Unknown');
            const stale = screenshot.render_storage_path !== null
                && screenshot.render_cloud_version !== screenshot.cloud_version;

            req.logCtx.set({ 'screenshot.render_published': imageUrl !== null, 'screenshot.render_stale': stale });
            return {
                name: screenshot.name,
                userName,
                widthPx: screenshot.width_px,
                heightPx: screenshot.height_px,
                imageUrl,
                stale,
            };
        },
    );
};
