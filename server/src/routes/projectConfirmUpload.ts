/**
 * POST /project-confirm-upload — flips upload_status 'pending' → 'ready'
 * after the client finishes uploading media (Part 2 Batch 2). Ports
 * project_confirm_upload inline: owner-only via the WHERE clause;
 * not-found / not-owned / already-ready are all `confirmed: false`
 * (the client only warns).
 *
 * Request:  { projectId }
 * Response: { confirmed: boolean }
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { ProjectConfirmUploadResponseSchema, ProjectIdRequestSchema } from '@shared/api/projects';

export const projectConfirmUploadRoutes: FastifyPluginAsyncTypebox = async (app) => {
    app.post(
        '/project-confirm-upload',
        {
            preHandler: app.requireUser,
            schema: {
                body: ProjectIdRequestSchema,
                response: { 200: ProjectConfirmUploadResponseSchema },
            },
        },
        async (req) => {
            const { projectId } = req.body;
            req.logCtx.set({ 'project.id': projectId });

            const { rowCount } = await app.deps.db.query(
                `UPDATE projects SET upload_status = 'ready'
                 WHERE id = $1 AND owner_id = $2 AND upload_status = 'pending'`,
                [projectId, req.user!.id],
            );
            return { confirmed: (rowCount ?? 0) > 0 };
        },
    );
};
