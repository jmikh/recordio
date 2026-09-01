/**
 * POST /project-get — full project metadata for an editor (Part 2 Batch 2).
 * Ports the project_get SQL function inline (frozen fn stays until the
 * Part 2 sweep): editor access (assert_project_editor semantics incl.
 * live workspace), bumps last_accessed_at, returns the project row +
 * editors list. The response keeps the jsonb field shape the client
 * already consumes (snake_case; project_data is arbitrary), so NO
 * response schema — serialization must not strip anything.
 *
 * Request:  { projectId }
 * Response: the project object (200) | 403 { error }
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { ProjectIdRequestSchema } from '@shared/api/projects';
import { canEditProject } from '../../services/projectAccess.js';

export const projectGetRoutes: FastifyPluginAsyncTypebox = async (app) => {
    app.post(
        '/project-get',
        {
            preHandler: app.requireUser,
            schema: {
                body: ProjectIdRequestSchema,
            },
        },
        async (req, reply) => {
            const { projectId } = req.body;
            req.logCtx.set({ 'project.id': projectId });

            if (!await canEditProject(app.deps.db, projectId, req.user!.id)) {
                return reply.code(403).send({ error: 'Not an editor of this project' });
            }

            await app.deps.db.query(
                `UPDATE projects SET last_accessed_at = NOW()
                 WHERE id = $1 AND deleted_at IS NULL`,
                [projectId],
            );

            const { rows } = await app.deps.db.query(
                `SELECT jsonb_build_object(
                    'id',                     p.id,
                    'name',                   p.name,
                    'created_by',             p.created_by,
                    'owner_id',               p.owner_id,
                    'workspace_id',           p.workspace_id,
                    'project_data',           p.project_data,
                    'cloud_version',          p.cloud_version,
                    'upload_status',          p.upload_status,
                    'last_accessed_at',       p.last_accessed_at,
                    'updated_at',             p.updated_at,
                    'created_at',             p.created_at,
                    'thumbnail_storage_path', p.thumbnail_storage_path,
                    'slug',                   p.slug,
                    'share_policy',           p.share_policy,
                    'is_shared',              p.slug IS NOT NULL,
                    'editors',                (
                        SELECT COALESCE(jsonb_agg(jsonb_build_object(
                            'user_id', pe.user_id,
                            'email',   u.email,
                            'name',    up.name
                        )), '[]'::jsonb)
                        FROM project_editors pe
                        JOIN auth.users u ON u.id = pe.user_id
                        LEFT JOIN user_profiles up ON up.user_id = pe.user_id
                        WHERE pe.project_id = p.id
                    )
                ) AS project
                FROM projects p
                WHERE p.id = $1 AND p.deleted_at IS NULL`,
                [projectId],
            );

            return reply.send((rows[0] as { project: unknown } | undefined)?.project ?? null);
        },
    );
};
