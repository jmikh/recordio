/**
 * POST /project-restore — restores a soft-deleted project
 * (Part 2 Batch 2). Ports project_restore inline: owner-only via the
 * WHERE clause; permanently-deleted projects cannot be restored.
 *
 * Request:  { projectId }
 * Response: { restored: boolean }
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { ProjectIdRequestSchema, ProjectRestoreResponseSchema } from '@shared/api/projects';

export const projectRestoreRoutes: FastifyPluginAsyncTypebox = async (app) => {
    app.post(
        '/project-restore',
        {
            preHandler: app.requireUser,
            schema: {
                body: ProjectIdRequestSchema,
                response: { 200: ProjectRestoreResponseSchema },
            },
        },
        async (req) => {
            const { projectId } = req.body;
            req.logCtx.set({ 'project.id': projectId });

            const { rowCount } = await app.deps.db.query(
                `UPDATE projects SET deleted_at = NULL
                 WHERE id = $1 AND owner_id = $2
                   AND deleted_at IS NOT NULL
                   AND permanently_deleted = false`,
                [projectId, req.user!.id],
            );
            return { restored: (rowCount ?? 0) > 0 };
        },
    );
};
