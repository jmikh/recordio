/**
 * POST /workspace-seats-set — sets the seat count on the workspace's
 * subscription (Part 2 Batch 3). Ports workspace_seats_set inline:
 * admin-only; seats ≥ 1 via the schema (replaces the RAISE); no
 * subscription row → 404.
 *
 * Request:  { workspaceId, seats }
 * Response: { seats } | 403/404 { error }
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import {
    WorkspaceSeatsSetRequestSchema,
    WorkspaceSeatsSetResponseSchema,
} from '@shared/api/workspaces';
import { isWorkspaceAdmin } from '../services/projectAccess.js';

export const workspaceSeatsSetRoutes: FastifyPluginAsyncTypebox = async (app) => {
    app.post(
        '/workspace-seats-set',
        {
            preHandler: app.requireUser,
            schema: {
                body: WorkspaceSeatsSetRequestSchema,
                response: {
                    200: WorkspaceSeatsSetResponseSchema,
                    403: Type.Object({ error: Type.String() }),
                    404: Type.Object({ error: Type.String() }),
                },
            },
        },
        async (req, reply) => {
            const { workspaceId, seats } = req.body;
            req.logCtx.set({ 'workspace.id': workspaceId });

            if (!await isWorkspaceAdmin(app.deps.db, workspaceId, req.user!.id)) {
                return reply.code(403).send({ error: 'Requires admin role in this workspace' });
            }

            const { rowCount } = await app.deps.db.query(
                `UPDATE subscriptions
                 SET seats = $2, updated_at = now()
                 WHERE workspace_id = $1`,
                [workspaceId, seats],
            );
            if ((rowCount ?? 0) === 0) {
                return reply.code(404).send({ error: 'No subscription found for this workspace' });
            }

            return { seats };
        },
    );
};
