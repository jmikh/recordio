/**
 * POST /screenshot-get — full screenshot row for an editor (sibling of
 * project-get). Editor access, bumps last_accessed_at, returns the row
 * in the snake_case jsonb shape the client consumes. NO response schema
 * — screenshot_data is arbitrary and must not be stripped.
 *
 * Request:  { screenshotId } | { slug } (the /screenshot/{slug}/edit route loads by slug)
 * Response: the screenshot object (200) | 400 { error } | 403 { error }
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { ScreenshotGetRequestSchema } from '@shared/api/screenshots';
import { canEditScreenshot } from '../../services/screenshotAccess.js';

export const screenshotGetRoutes: FastifyPluginAsyncTypebox = async (app) => {
    app.post(
        '/screenshot-get',
        {
            preHandler: app.requireUser,
            schema: {
                body: ScreenshotGetRequestSchema,
            },
        },
        async (req, reply) => {
            let screenshotId = req.body.screenshotId;
            if (!screenshotId) {
                if (!req.body.slug) {
                    return reply.code(400).send({ error: 'screenshotId or slug required' });
                }
                const { rows } = await app.deps.db.query(
                    'SELECT id FROM screenshots WHERE slug = $1 AND deleted_at IS NULL',
                    [req.body.slug],
                );
                screenshotId = (rows[0] as { id: string } | undefined)?.id;
                if (!screenshotId) {
                    // Unknown slug is indistinguishable from no access
                    return reply.code(403).send({ error: 'Not an editor of this screenshot' });
                }
            }
            req.logCtx.set({ 'screenshot.id': screenshotId });

            if (!await canEditScreenshot(app.deps.db, screenshotId, req.user!.id)) {
                return reply.code(403).send({ error: 'Not an editor of this screenshot' });
            }

            await app.deps.db.query(
                `UPDATE screenshots SET last_accessed_at = NOW()
                 WHERE id = $1 AND deleted_at IS NULL`,
                [screenshotId],
            );

            const { rows } = await app.deps.db.query(
                `SELECT jsonb_build_object(
                    'id',                     s.id,
                    'name',                   s.name,
                    'created_by',             s.created_by,
                    'owner_id',               s.owner_id,
                    'workspace_id',           s.workspace_id,
                    'screenshot_data',        s.screenshot_data,
                    'source_storage_path',    s.source_storage_path,
                    'width_px',               s.width_px,
                    'height_px',              s.height_px,
                    'capture_mode',           s.capture_mode,
                    'page_url',               s.page_url,
                    'page_title',             s.page_title,
                    'thumbnail_storage_path', s.thumbnail_storage_path,
                    'upload_status',          s.upload_status,
                    'cloud_version',          s.cloud_version,
                    'slug',                   s.slug,
                    'share_policy',           s.share_policy,
                    'workspace_access',       s.workspace_access,
                    'is_shared',              s.share_policy IN ('public', 'workspace'),
                    'render_storage_path',    s.render_storage_path,
                    'render_cloud_version',   s.render_cloud_version,
                    'last_accessed_at',       s.last_accessed_at,
                    'updated_at',             s.updated_at,
                    'created_at',             s.created_at,
                    'owner_email',            (
                        SELECT u.email FROM auth.users u WHERE u.id = s.owner_id
                    ),
                    'owner_name',             (
                        SELECT up.name FROM user_profiles up WHERE up.user_id = s.owner_id
                    )
                ) AS screenshot
                FROM screenshots s
                WHERE s.id = $1 AND s.deleted_at IS NULL`,
                [screenshotId],
            );

            return reply.send((rows[0] as { screenshot: unknown } | undefined)?.screenshot ?? null);
        },
    );
};
