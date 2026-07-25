/**
 * POST /workspace-set-default — persists the caller's default workspace
 * (Part 2 Batch 3). Ports workspace_set_default inline: any member of a
 * live workspace. The client fires-and-forgets this on workspace
 * switch.
 *
 * Request:  { workspaceId }
 * Response: { ok: true } | 403 { error }
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import {
    WorkspaceIdRequestSchema,
    WorkspaceSetDefaultResponseSchema,
} from '@shared/api/workspaces';
import { isWorkspaceMember } from '../../services/projectAccess.js';

export const workspaceSetDefaultRoutes: FastifyPluginAsyncTypebox = async (app) => {
    app.post(
        '/workspace-set-default',
        {
            preHandler: app.requireUser,
            schema: {
                body: WorkspaceIdRequestSchema,
                response: {
                    200: WorkspaceSetDefaultResponseSchema,
                    403: Type.Object({ error: Type.String() }),
                },
            },
        },
        async (req, reply) => {
            const { workspaceId } = req.body;
            req.logCtx.set({ 'workspace.id': workspaceId });

            if (!await isWorkspaceMember(app.deps.db, workspaceId, req.user!.id)) {
                return reply.code(403).send({ error: 'Requires membership in this workspace' });
            }

            await app.deps.db.query(
                `UPDATE user_profiles
                 SET default_workspace_id = $1, updated_at = now()
                 WHERE user_id = $2`,
                [workspaceId, req.user!.id],
            );
            return { ok: true as const };
        },
    );
};
