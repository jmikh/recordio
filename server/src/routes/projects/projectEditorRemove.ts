/**
 * POST /project-editor-remove — revokes an individual member's access
 * to a project (share-access model). OWNER-only. Idempotent (removing
 * a missing grant is a no-op), and deliberately NOT entitlement-gated:
 * un-sharing must always work, parity with sharePolicy 'private'.
 *
 * Request:  { projectId, userId }
 * Response: { editors } | 403 { error } | 404 { error }
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import {
    ProjectEditorRemoveRequestSchema,
    ProjectEditorsResponseSchema,
} from '@shared/api/projects';
import { listProjectEditors } from '../../services/projectAccess.js';

export const projectEditorRemoveRoutes: FastifyPluginAsyncTypebox = async (app) => {
    app.post(
        '/project-editor-remove',
        {
            preHandler: app.requireUser,
            schema: {
                body: ProjectEditorRemoveRequestSchema,
                response: {
                    200: ProjectEditorsResponseSchema,
                    403: Type.Object({ error: Type.String() }),
                    404: Type.Object({ error: Type.String() }),
                },
            },
        },
        async (req, reply) => {
            const { projectId, userId } = req.body;
            const db = app.deps.db;
            req.logCtx.set({ 'project.id': projectId });

            const { rows } = await db.query(
                `SELECT owner_id AS "ownerId"
                 FROM projects
                 WHERE id = $1 AND deleted_at IS NULL`,
                [projectId],
            );
            const project = rows[0] as { ownerId: string } | undefined;

            if (!project) {
                return reply.code(404).send({ error: 'Project not found' });
            }
            if (project.ownerId !== req.user!.id) {
                return reply.code(403).send({ error: 'Only the project owner can manage project sharing' });
            }

            await db.query(
                'DELETE FROM project_editors WHERE project_id = $1 AND user_id = $2',
                [projectId, userId],
            );

            return { editors: await listProjectEditors(db, projectId) };
        },
    );
};
