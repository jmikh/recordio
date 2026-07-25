/**
 * POST /workspace-invite-rescind — deletes a pending invitation
 * (Part 2 Batch 3). Ports workspace_invite_rescind inline: the
 * invitation's workspace is looked up first, then the caller must be
 * its admin. Not-found/already-resolved → 404 (the client shows a
 * generic toast; message parity kept anyway).
 *
 * Request:  { invitationId }
 * Response: { invitationId } | 404 { error } | 403 { error }
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import {
    WorkspaceInviteRescindRequestSchema,
    WorkspaceInviteRescindResponseSchema,
} from '@shared/api/workspaces';
import { isWorkspaceAdmin } from '../services/projectAccess.js';

export const workspaceInviteRescindRoutes: FastifyPluginAsyncTypebox = async (app) => {
    app.post(
        '/workspace-invite-rescind',
        {
            preHandler: app.requireUser,
            schema: {
                body: WorkspaceInviteRescindRequestSchema,
                response: {
                    200: WorkspaceInviteRescindResponseSchema,
                    403: Type.Object({ error: Type.String() }),
                    404: Type.Object({ error: Type.String() }),
                },
            },
        },
        async (req, reply) => {
            const { invitationId } = req.body;
            const db = app.deps.db;

            const { rows } = await db.query(
                `SELECT workspace_id AS "workspaceId"
                 FROM workspace_invitations
                 WHERE id = $1 AND status = 'pending'`,
                [invitationId],
            );
            const workspaceId = (rows[0] as { workspaceId: string } | undefined)?.workspaceId;
            if (!workspaceId) {
                return reply.code(404).send({ error: 'Invitation not found or already resolved' });
            }
            req.logCtx.set({ 'workspace.id': workspaceId });

            if (!await isWorkspaceAdmin(db, workspaceId, req.user!.id)) {
                return reply.code(403).send({ error: 'Requires admin role in this workspace' });
            }

            await db.query('DELETE FROM workspace_invitations WHERE id = $1', [invitationId]);
            return { invitationId };
        },
    );
};
