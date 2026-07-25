/**
 * POST /workspace-invite — creates a fresh invitation (re-invite
 * deletes any prior one for the email) and sends the invite email
 * (Part 2 Batch 3). Ports workspace_invite inline: admin-only;
 * lower(email); role enum enforced by the schema (replaces the
 * 'Invalid role' RAISE); invitations don't expire.
 *
 * The SQL fn's pg_net hop to /send-workspace-invite-email becomes an
 * IN-PROCESS call to the shared service — fire-and-forget with a
 * logged failure (pg_net parity: invite creation succeeds even if the
 * email fails).
 *
 * Request:  { workspaceId, email, role }
 * Response: { invitationId, token } | 403 { error }
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import {
    WorkspaceInviteRequestSchema,
    WorkspaceInviteResponseSchema,
} from '@shared/api/workspaces';
import { isWorkspaceAdmin } from '../services/projectAccess.js';
import { sendWorkspaceInviteEmail } from '../services/workspaceInviteEmail.js';

export const workspaceInviteRoutes: FastifyPluginAsyncTypebox = async (app) => {
    app.post(
        '/workspace-invite',
        {
            preHandler: app.requireUser,
            schema: {
                body: WorkspaceInviteRequestSchema,
                response: {
                    200: WorkspaceInviteResponseSchema,
                    403: Type.Object({ error: Type.String() }),
                },
            },
        },
        async (req, reply) => {
            const { workspaceId, role } = req.body;
            const email = req.body.email.toLowerCase();
            const userId = req.user!.id;
            const db = app.deps.db;
            req.logCtx.set({ 'workspace.id': workspaceId });

            if (!await isWorkspaceAdmin(db, workspaceId, userId)) {
                return reply.code(403).send({ error: 'Requires admin role in this workspace' });
            }

            await db.query(
                `DELETE FROM workspace_invitations
                 WHERE workspace_id = $1 AND email = $2`,
                [workspaceId, email],
            );
            const { rows } = await db.query(
                `INSERT INTO workspace_invitations
                    (workspace_id, email, role, invited_by, token, status)
                 VALUES ($1, $2, $3, $4, gen_random_uuid(), 'pending')
                 RETURNING id AS "invitationId", token`,
                [workspaceId, email, role, userId],
            );
            const { invitationId, token } = rows[0] as { invitationId: string; token: string };

            const log = req.log;
            void sendWorkspaceInviteEmail(app.deps, {
                workspaceId,
                email,
                role,
                token,
                invitedBy: userId,
            }, req.logCtx).catch((err: unknown) => {
                log.warn(
                    { err, 'workspace.id': workspaceId, 'email.template': 'workspace-invite' },
                    'workspace invite email failed',
                );
            });

            return { invitationId, token };
        },
    );
};
