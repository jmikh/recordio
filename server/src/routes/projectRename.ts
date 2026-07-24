/**
 * POST /project-rename — renames a project (Part 2 Batch 2). Ports
 * project_rename inline. Identical to /project-update-name (the SQL fns
 * were exact duplicates — logged in suggested_changes); ported for
 * call-site parity.
 *
 * Request:  { projectId, name }
 * Response: { ok: true } | 403 { error }
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import { canEditProject } from '../services/projectAccess.js';

export const projectRenameRoutes: FastifyPluginAsyncTypebox = async (app) => {
    app.post(
        '/project-rename',
        {
            preHandler: app.requireUser,
            schema: {
                body: Type.Object({
                    projectId: Type.String({ minLength: 1 }),
                    name: Type.String(),
                }),
                response: {
                    200: Type.Object({ ok: Type.Literal(true) }),
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
