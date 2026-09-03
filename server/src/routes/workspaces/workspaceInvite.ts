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
import { getWorkspaceEntitlements } from '../../services/entitlements.js';
import { isWorkspaceAdmin } from '../../services/projectAccess.js';
import { VIEWER_CEILING } from '../../services/seatBilling.js';
import { sendWorkspaceInviteEmail } from '../../services/workspaceInviteEmail.js';

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
                    409: Type.Object({ error: Type.String() }),
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

            // Collaboration is Pro-only (revamp Step 6) — free AND trial
            // workspaces are strictly solo; dunning (past_due) keeps rights.
            const entitlements = await getWorkspaceEntitlements(db, app.deps.clock, workspaceId);
            if (!entitlements.canInvite) {
                return reply
                    .code(403)
                    .send({ error: 'Inviting members requires an active subscription' });
            }

            // Hidden viewer ceiling (abuse backstop, revamp Step 6) —
            // accepted viewers + pending viewer invites both count, or the
            // ceiling is trivially bypassed by mass-inviting.
            if (role === 'viewer') {
                const { rows: viewerRows } = await db.query(
                    `SELECT
                        (SELECT COUNT(*) FROM workspace_members wm
                         WHERE wm.workspace_id = $1 AND wm.role = 'viewer')
                      + (SELECT COUNT(*) FROM workspace_invitations wi
                         WHERE wi.workspace_id = $1 AND wi.status = 'pending'
                           AND wi.role = 'viewer' AND wi.email <> $2) AS count`,
                    [workspaceId, email],
                );
                const viewerCount = Number((viewerRows[0] as { count: string | number }).count);
                if (viewerCount >= VIEWER_CEILING) {
                    return reply
                        .code(403)
                        .send({ error: 'Viewer limit reached — contact support to increase it' });
                }
            }

            // The owner has no workspace_members row (revamp Step 2), so
            // the accept-side upsert would happily create one — refuse
            // their email here instead.
            const { rows: ownerRows } = await db.query(
                `SELECT 1
                 FROM workspaces w
                 JOIN auth.users u ON u.id = w.owner_id
                 WHERE w.id = $1 AND lower(u.email) = $2
                 LIMIT 1`,
                [workspaceId, email],
            );
            if (ownerRows.length > 0) {
                return reply.code(409).send({ error: 'This email belongs to the workspace owner' });
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
