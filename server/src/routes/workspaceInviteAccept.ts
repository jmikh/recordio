/**
 * POST /workspace-invite-accept — joins the caller to the invitation's
 * workspace (Part 2 Batch 3). Ports workspace_invite_accept inline:
 * token+pending lookup; the invite email must match the caller's token
 * email (auth.email() → the verified JWT's email claim); member row
 * UPSERTS (re-invite updates the role); invitation marked accepted;
 * the joined workspace becomes the caller's default.
 *
 * Business failures are 200 + { error } with the SQL fn's EXACT
 * messages — AcceptInvitePage displays them (the asset-upload
 * `library_full` precedent).
 *
 * Request:  { token }
 * Response: { workspaceId, role } | { error }
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import {
    WorkspaceInviteAcceptRequestSchema,
    WorkspaceInviteAcceptResponseSchema,
} from '@shared/api/workspaces';

export const workspaceInviteAcceptRoutes: FastifyPluginAsyncTypebox = async (app) => {
    app.post(
        '/workspace-invite-accept',
        {
            preHandler: app.requireUser,
            schema: {
                body: WorkspaceInviteAcceptRequestSchema,
                response: { 200: WorkspaceInviteAcceptResponseSchema },
            },
        },
        async (req) => {
            const userId = req.user!.id;
            const db = app.deps.db;

            const { rows } = await db.query(
                `SELECT id, workspace_id AS "workspaceId", email, role
                 FROM workspace_invitations
                 WHERE token = $1 AND status = 'pending'`,
                [req.body.token],
            );
            const inv = rows[0] as
                | { id: string; workspaceId: string; email: string; role: 'viewer' | 'creator' | 'admin' }
                | undefined;

            if (!inv) {
                return { error: 'Invitation not found or already used' };
            }
            req.logCtx.set({ 'workspace.id': inv.workspaceId });

            const callerEmail = req.user!.email;
            if (!callerEmail || inv.email.toLowerCase() !== callerEmail.toLowerCase()) {
                return { error: 'This invitation was sent to a different email address' };
            }

            await db.query(
                `INSERT INTO workspace_members (workspace_id, user_id, role)
                 VALUES ($1, $2, $3)
                 ON CONFLICT (workspace_id, user_id) DO UPDATE
                     SET role = EXCLUDED.role, updated_at = now()`,
                [inv.workspaceId, userId, inv.role],
            );
            await db.query(
                `UPDATE workspace_invitations SET status = 'accepted' WHERE id = $1`,
                [inv.id],
            );
            await db.query(
                `UPDATE user_profiles
                 SET default_workspace_id = $1, updated_at = now()
                 WHERE user_id = $2`,
                [inv.workspaceId, userId],
            );

            return { workspaceId: inv.workspaceId, role: inv.role };
        },
    );
};
