/**
 * POST /project-list — project summaries for a workspace member
 * (Part 2 Batch 2). Ports the project_list SQL function inline: any
 * member of a live workspace; not-permanently-deleted projects
 * INCLUDING soft-deleted ones (the client filters by deleted_at);
 * newest-updated first. Summary rows keep the jsonb field shape the
 * client consumes (snake_case) — no per-row response schema.
 *
 * Ready projects for everyone; PENDING ones (upload never finished)
 * only when the caller owns them and they aren't trashed — the media
 * can only be in the owner's browser cache, which is where the upload
 * resumes from (plans/background-activity-oneshot.md). Those rows carry
 * `media_paths` (the recording's screen/camera/mic paths lifted out of
 * project_data — background/music assets are never in that cache) so
 * the client can check the cache and restart the upload; project_data
 * itself stays out of the response.
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
import { getProjectMediaPaths } from '../../services/projectMedia.js';

const RECORDING_MEDIA_TYPES = new Set(['screen', 'camera', 'mic']);

interface ListRow {
    project: Record<string, unknown> & { upload_status: string; project_data?: unknown };
}

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
                `SELECT jsonb_build_object(
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
                    'workspace_access',       p.workspace_access,
                    'upload_status',          p.upload_status,
                    'is_shared',              p.share_policy IN ('public', 'workspace'),
                    'is_editor',              EXISTS (
                        SELECT 1 FROM project_editors pe
                        WHERE pe.project_id = p.id AND pe.user_id = $2
                    ),
                    'editor_role',            (
                        SELECT pe.role FROM project_editors pe
                        WHERE pe.project_id = p.id AND pe.user_id = $2
                    ),
                    'project_data',           CASE WHEN p.upload_status = 'pending' THEN p.project_data END
                ) AS project
                FROM projects p
                WHERE p.workspace_id = $1
                  AND p.permanently_deleted = false
                  AND (
                       p.upload_status = 'ready'
                    OR (p.upload_status = 'pending' AND p.owner_id = $2 AND p.deleted_at IS NULL)
                  )
                ORDER BY p.updated_at DESC`,
                [workspaceId, req.user!.id],
            );

            const projects = (rows as ListRow[]).map(({ project }) => {
                const { project_data, ...summary } = project;
                if (project.upload_status !== 'pending') return summary;
                return {
                    ...summary,
                    media_paths: getProjectMediaPaths(project_data).filter(e => RECORDING_MEDIA_TYPES.has(e.type)),
                };
            });

            return reply.send({ projects });
        },
    );
};
