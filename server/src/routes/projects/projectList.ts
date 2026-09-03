/**
 * POST /project-list — project summaries for a workspace member
 * (Part 2 Batch 2). Ports the project_list SQL function inline: any
 * member of a live workspace; ready, not-permanently-deleted projects
 * INCLUDING soft-deleted ones (the client filters by deleted_at);
 * newest-updated first. Summary rows keep the jsonb field shape the
 * client consumes (snake_case) — no per-row response schema.
 *
 * Ordering deliberately uses the column (the SQL fn text-compares the
 * rendered timestamp — same smell as asset_list, fixed on the live path).
 *
 * Request:  { workspaceId }
 * Response: { projects: [...] } | 403 { error }
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { ProjectListRequestSchema } from '@shared/api/projects';
import { isWorkspaceMember } from '../../services/projectAccess.js';

export const projectListRoutes: FastifyPluginAsyncTypebox = async (app) => {
    app.post(
        '/project-list',
        {
            preHandler: app.requireUser,
            schema: {
                body: ProjectListRequestSchema,
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
                    'id',                     p.id,
                    'name',                   p.name,
                    'created_by',             p.created_by,
                    'owner_id',               p.owner_id,
                    'workspace_id',           p.workspace_id,
                    'thumbnail_storage_path', p.thumbnail_storage_path,
                    'last_accessed_at',       p.last_accessed_at,
                    'updated_at',             p.updated_at,
                    'created_at',             p.created_at,
                    'deleted_at',             p.deleted_at,
                    'cloud_version',          p.cloud_version,
                    'duration_ms',            p.duration_ms,
                    'slug',                   p.slug,
                    'share_policy',           p.share_policy,
                    'is_shared',              p.slug IS NOT NULL,
                    'is_editor',              EXISTS (
                        SELECT 1 FROM project_editors pe
                        WHERE pe.project_id = p.id AND pe.user_id = $2
                    )
                ) ORDER BY p.updated_at DESC), '[]'::jsonb) AS projects
                FROM projects p
                WHERE p.workspace_id = $1
                  AND p.permanently_deleted = false
                  AND p.upload_status = 'ready'`,
                [workspaceId, req.user!.id],
            );

            return reply.send({
                projects: (rows[0] as { projects: unknown[] }).projects,
            });
        },
    );
};
