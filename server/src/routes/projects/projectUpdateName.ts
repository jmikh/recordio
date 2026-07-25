/**
 * POST /project-update-name — updates only the name column
 * (Part 2 Batch 2). Ports project_update_name inline: editor access,
 * live projects only. NOTE: functionally identical to /project-rename —
 * the SQL fns were exact duplicates (logged in suggested_changes); both
 * are ported for call-site parity, consolidation is a later cleanup.
 *
 * Request:  { projectId, name }
 * Response: { ok: true } | 403 { error }
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import { ProjectNameUpdateRequestSchema, ProjectNameUpdateResponseSchema } from '@shared/api/projects';
import { canEditProject } from '../../services/projectAccess.js';

export const projectUpdateNameRoutes: FastifyPluginAsyncTypebox = async (app) => {
    app.post(
        '/project-update-name',
        {
            preHandler: app.requireUser,
            schema: {
                body: ProjectNameUpdateRequestSchema,
                response: {
                    200: ProjectNameUpdateResponseSchema,
                    403: Type.Object({ error: Type.String() }),
                },
            },
        },
        async (req, reply) => {
            const { projectId, name } = req.body;
            req.logCtx.set({ 'project.id': projectId });

            if (!await canEditProject(app.deps.db, projectId, req.user!.id)) {
                return reply.code(403).send({ error: 'Not an editor of this project' });
            }

            await app.deps.db.query(
                `UPDATE projects SET name = $2, updated_at = NOW()
                 WHERE id = $1 AND deleted_at IS NULL`,
                [projectId, name],
            );
            return { ok: true as const };
        },
    );
};
