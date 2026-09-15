/**
 * POST /screenshot-list — screenshot summaries for a workspace member
 * (sibling of project-list): any member of a live workspace; ready,
 * not-permanently-deleted screenshots INCLUDING soft-deleted ones (the
 * dashboard's Trash view filters by deleted_at); newest-updated first.
 *
 * Request:  { workspaceId }
 * Response: { screenshots: [...] } | 403 { error }
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { ScreenshotListRequestSchema } from '@shared/api/screenshots';
import { isWorkspaceMember } from '../../services/projectAccess.js';

export const screenshotListRoutes: FastifyPluginAsyncTypebox = async (app) => {
    app.post(
        '/screenshot-list',
        {
            preHandler: app.requireUser,
            schema: {
                body: ScreenshotListRequestSchema,
            },
        },
        async (req, reply) => {
            const { workspaceId } = req.body;
            req.logCtx.set({ 'workspace.id': workspaceId });

            if (!await isWorkspaceMember(app.deps.db, workspaceId, req.user!.id)) {
                return reply.code(403).send({ error: 'Not a member of this workspace' });
            }

            const { rows } = await app.deps.db.query(
                `SELECT COALESCE(jsonb_agg(jsonb_build_object(
                    'id',                     s.id,
                    'name',                   s.name,
                    'created_by',             s.created_by,
                    'owner_id',               s.owner_id,
                    'workspace_id',           s.workspace_id,
                    'thumbnail_storage_path', s.thumbnail_storage_path,
                    'width_px',               s.width_px,
                    'height_px',              s.height_px,
                    'capture_mode',           s.capture_mode,
                    'page_url',               s.page_url,
                    'last_accessed_at',       s.last_accessed_at,
                    'updated_at',             s.updated_at,
                    'created_at',             s.created_at,
                    'deleted_at',             s.deleted_at,
                    'cloud_version',          s.cloud_version,
                    'slug',                   s.slug,
                    'share_policy',           s.share_policy,
                    'workspace_access',       s.workspace_access,
                    'is_shared',              s.share_policy IN ('public', 'workspace')
                ) ORDER BY s.updated_at DESC), '[]'::jsonb) AS screenshots
                FROM screenshots s
                WHERE s.workspace_id = $1
                  AND s.permanently_deleted = false
                  AND s.upload_status = 'ready'`,
                [workspaceId],
            );

            return reply.send({
                screenshots: (rows[0] as { screenshots: unknown[] }).screenshots,
            });
        },
    );
};
