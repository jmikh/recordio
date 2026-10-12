/**
 * POST /project-delete-permanent — "Delete forever" from the Trash.
 * Only marks the row `permanently_deleted`: from then on it's hidden
 * from project-list and can't be restored. The daily
 * `projects.purge-deleted` job picks marked rows up without the 30-day
 * wait and does the actual purge (Mux assets, storage prefix, row).
 *
 * Permissions: signed-in user (requireUser) who OWNS the project — the
 * owner check is the UPDATE's WHERE clause, so editors, workspace
 * members and admins all match zero rows. Trash-only: a live project
 * must go through /project-delete first. Non-owner, live,
 * already-marked, and missing are all just `deleted: false`, no error
 * (same shape as /project-delete). Not on the impersonation allowlist,
 * so the auth plugin refuses it while impersonating.
 *
 * Request:  { projectId }
 * Response: { deleted: boolean }
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { ProjectDeleteResponseSchema, ProjectIdRequestSchema } from '@shared/api/projects';

export const projectDeletePermanentRoutes: FastifyPluginAsyncTypebox = async (app) => {
    app.post(
        '/project-delete-permanent',
        {
            preHandler: app.requireUser,
            schema: {
                body: ProjectIdRequestSchema,
                response: { 200: ProjectDeleteResponseSchema },
            },
        },
        async (req) => {
            const { projectId } = req.body;
            req.logCtx.set({ 'project.id': projectId });

            const { rowCount } = await app.deps.db.query(
                `UPDATE projects SET permanently_deleted = true
                 WHERE id = $1 AND owner_id = $2
                   AND deleted_at IS NOT NULL
                   AND permanently_deleted = false`,
                [projectId, req.user!.id],
            );
            return { deleted: (rowCount ?? 0) > 0 };
        },
    );
};
