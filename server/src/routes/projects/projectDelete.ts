/**
 * POST /project-delete — soft-deletes a project (Part 2 Batch 2). Ports
 * project_delete inline: the owner check IS the UPDATE's WHERE clause
 * (SQL parity — non-owner, already-deleted, and missing are all just
 * `deleted: false`, no error).
 *
 * Request:  { projectId }
 * Response: { deleted: boolean }
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { ProjectDeleteResponseSchema, ProjectIdRequestSchema } from '@shared/api/projects';

export const projectDeleteRoutes: FastifyPluginAsyncTypebox = async (app) => {
    app.post(
        '/project-delete',
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
                `UPDATE projects SET deleted_at = NOW()
                 WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL`,
                [projectId, req.user!.id],
            );
            return { deleted: (rowCount ?? 0) > 0 };
        },
    );
};
