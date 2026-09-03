/**
 * POST /workspace-invite-accept — joins the caller to the invitation's
 * workspace (Part 2 Batch 3; seat auto-scaling revamp Step 6). Token+
 * pending lookup; the invite email must match the caller's token email
 * (auth.email() → the verified JWT's email claim); a lapsed-subscription
 * guard (acceptance consumes a billed seat — a workspace that is no
 * longer pro must not grow); then ONE atomic data-modifying-CTE
 * statement: member row UPSERTS (re-invite updates the role) +
 * invitation marked accepted + the joined workspace becomes the
 * caller's default. Creator/admin acceptance then syncs the Stripe
 * quantity (Step 6 — seats are consumed on acceptance, never on
 * pending invites; the sync never throws or blocks the join).
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
import { getWorkspaceEntitlements } from '../../services/entitlements.js';
import { syncSeatQuantity } from '../../services/seatBilling.js';

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

            // The owner is never a member row (revamp Step 2) — a stale
            // pre-guard invitation for their email must not create one.
            const { rows: ownerRows } = await db.query(
                `SELECT 1 FROM workspaces WHERE id = $1 AND owner_id = $2 LIMIT 1`,
                [inv.workspaceId, userId],
            );
            if (ownerRows.length > 0) {
                return { error: 'You already own this workspace' };
            }

            // Lapse guard (revamp Step 6): acceptance consumes a billed
            // seat, so a workspace that is no longer pro must not grow.
            // Step 7 will revoke pending invites on lapse; this is the
            // belt underneath it.
            const entitlements = await getWorkspaceEntitlements(
                db, app.deps.clock, inv.workspaceId,
            );
            if (!entitlements.canInvite) {
                return { error: "This workspace's subscription is no longer active" };
            }

            // One statement — data-modifying CTEs are atomic, and the Db
            // port has no transaction surface (pool queries may hop
            // connections, so BEGIN/COMMIT across query() calls is unsafe).
            await db.query(
                `WITH member AS (
                    INSERT INTO workspace_members (workspace_id, user_id, role)
                    VALUES ($1, $2, $3)
                    ON CONFLICT (workspace_id, user_id) DO UPDATE
                        SET role = EXCLUDED.role, updated_at = now()
                ),
                accepted AS (
                    UPDATE workspace_invitations SET status = 'accepted' WHERE id = $4
                )
                UPDATE user_profiles
                SET default_workspace_id = $1, updated_at = now()
                WHERE user_id = $2`,
                [inv.workspaceId, userId, inv.role, inv.id],
            );

            // Seats are consumed on acceptance (revamp Step 6): sync the
            // Stripe quantity to the recomputed count. Never throws — a
            // billing hiccup must not fail the join.
            if (inv.role !== 'viewer') {
                const { rows: nameRows } = await db.query(
                    'SELECT name FROM user_profiles WHERE user_id = $1',
                    [userId],
                );
                await syncSeatQuantity(app.deps, inv.workspaceId, {
                    kind: 'joined',
                    memberEmail: inv.email,
                    memberName: (nameRows[0] as { name: string | null } | undefined)?.name ?? null,
                    role: inv.role,
                }, req.log);
            }

            return { workspaceId: inv.workspaceId, role: inv.role };
        },
    );
};
