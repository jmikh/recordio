/**
 * POST /project-get — full project metadata for an editor (Part 2 Batch 2).
 * Ports the project_get SQL function inline (frozen fn stays until the
 * Part 2 sweep): editor access (assert_project_editor semantics incl.
 * live workspace), bumps last_accessed_at, returns the project row +
 * editors list. The response keeps the jsonb field shape the client
 * already consumes (snake_case; project_data is arbitrary), so NO
 * response schema — serialization must not strip anything.
 *
 * The editor's media comes with it: `media_urls` holds a presigned GET
 * per media path (the access check above is what authorizes them — there
 * is no generic signing endpoint). Signed: paths inside the project's
 * namespace, plus anything under the caller's own prefix (covers library
 * references not yet copied in by scripts/projectAssetsLocalize.ts).
 * Pre-v5 projects get their deterministic recording paths filled in
 * first, so they sign like any other.
 *
 * Request:  { projectId } | { slug } (share-access model: the editor
 *           route /video/{slug}/edit loads by slug)
 * Response: the project object (200) | 400 { error } | 403 { error }
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { ProjectGetRequestSchema } from '@shared/api/projects';
import { canEditProject } from '../../services/projectAccess.js';
import { backfillLegacyMediaPaths, getProjectMediaPaths } from '../../services/projectMedia.js';
import { presignDownloads } from '../../services/downloadUrls.js';
import { isProjectPath, isUserPath } from '../../services/storagePaths.js';
import { isImpersonating } from '../../plugins/auth.js';

/** The slice of the jsonb row this route post-processes; the rest passes through. */
type ProjectRow = Record<string, unknown> & { created_by: string; project_data: unknown };

export const projectGetRoutes: FastifyPluginAsyncTypebox = async (app) => {
    app.post(
        '/project-get',
        {
            preHandler: app.requireUser,
            schema: {
                body: ProjectGetRequestSchema,
            },
        },
        async (req, reply) => {
            let projectId = req.body.projectId;
            if (!projectId) {
                if (!req.body.slug) {
                    return reply.code(400).send({ error: 'projectId or slug required' });
                }
                const { rows } = await app.deps.db.query(
                    'SELECT id FROM projects WHERE slug = $1 AND deleted_at IS NULL',
                    [req.body.slug],
                );
                projectId = (rows[0] as { id: string } | undefined)?.id;
                if (!projectId) {
                    // Unknown slug is indistinguishable from no access
                    return reply.code(403).send({ error: 'Not an editor of this project' });
                }
            }
            req.logCtx.set({ 'project.id': projectId });

            if (!await canEditProject(app.deps.db, projectId, req.user!.id)) {
                return reply.code(403).send({ error: 'Not an editor of this project' });
            }

            // An impersonating admin leaves no trace: bumping this would
            // reorder the user's own dashboard behind their back
            if (!isImpersonating(req)) {
                await app.deps.db.query(
                    `UPDATE projects SET last_accessed_at = NOW()
                     WHERE id = $1 AND deleted_at IS NULL`,
                    [projectId],
                );
            }

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
                    'workspace_access',       p.workspace_access,
                    'is_shared',              p.share_policy IN ('public', 'workspace'),
                    'owner_email',            (
                        SELECT u.email FROM auth.users u WHERE u.id = p.owner_id
                    ),
                    'owner_name',             (
                        SELECT up.name FROM user_profiles up WHERE up.user_id = p.owner_id
                    ),
                    'editors',                (
                        SELECT COALESCE(jsonb_agg(jsonb_build_object(
                            'user_id', pe.user_id,
                            'email',   u.email,
                            'name',    up.name,
                            'role',    pe.role
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

            const project = (rows[0] as { project: ProjectRow } | undefined)?.project;
            if (!project) return reply.send(null);

            backfillLegacyMediaPaths(project.project_data, project.created_by, projectId);
            const paths = getProjectMediaPaths(project.project_data).map(e => e.storagePath);
            const signable = paths.filter(p => isProjectPath(p, projectId) || isUserPath(p, req.user!.id));
            if (signable.length < paths.length) {
                req.log.warn(
                    { 'project.id': projectId, unsigned: paths.filter(p => !signable.includes(p)) },
                    'project-get: media paths outside the project namespace left unsigned',
                );
            }

            return reply.send({ ...project, media_urls: await presignDownloads(app.deps.s3, signable) });
        },
    );
};
