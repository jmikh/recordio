/**
 * POST /project-restore — restores a soft-deleted project
 * (Part 2 Batch 2). Ports project_restore inline: owner-only via the
 * WHERE clause; permanently-deleted projects cannot be restored.
 *
 * Restore is trial/Pro (billing revamp Step 4 — previously the gate
 * was client-side only): the project's workspace must have canRestore,
 * else 403 subscription_required. Unknown/non-owned projects keep
 * returning { restored: false } — indistinguishable from a no-op, same
 * information hiding as before the gate.
 *
 * Request:  { projectId }
 * Response: { restored: boolean } | 403 { error }
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import { ProjectIdRequestSchema, ProjectRestoreResponseSchema } from '@shared/api/projects';
import { getWorkspaceEntitlements } from '../../services/entitlements.js';

export const projectRestoreRoutes: FastifyPluginAsyncTypebox = async (app) => {
    app.post(
        '/project-restore',
        {
            preHandler: app.requireUser,
            schema: {
                body: ProjectIdRequestSchema,
                response: {
                    200: ProjectRestoreResponseSchema,
                    403: Type.Object({ error: Type.String() }),
                },
            },
        },
        async (req, reply) => {
            const { projectId } = req.body;
            req.logCtx.set({ 'project.id': projectId });

            const { rows } = await app.deps.db.query(
                `SELECT workspace_id AS "workspaceId" FROM projects
                 WHERE id = $1 AND owner_id = $2`,
                [projectId, req.user!.id],
            );
            const workspaceId = (rows[0] as { workspaceId: string } | undefined)?.workspaceId;
            if (workspaceId) {
                const entitlements = await getWorkspaceEntitlements(
                    app.deps.db,
                    app.deps.clock,
                    workspaceId,
                );
                if (!entitlements.canRestore) {
                    return reply.code(403).send({ error: 'subscription_required' });
                }
            }

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
