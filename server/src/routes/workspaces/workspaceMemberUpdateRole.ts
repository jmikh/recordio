/**
 * POST /workspace-member-update-role — changes a member's role
 * (Part 2 Batch 3; seat auto-scaling revamp Step 6). Admin-only; the
 * owner's role is locked; role enum via the schema (replaces the
 * 'Invalid role' RAISE). Crossing the viewer↔(creator|admin) boundary
 * moves the billed seat count: promotions are gated on an active
 * subscription (they grow the bill) and both directions sync the
 * Stripe quantity afterward.
 *
 * Request:  { workspaceId, userId, role }
 * Response: { ok: true } | 403/404/409 { error }
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import {
    WorkspaceMemberUpdateRoleRequestSchema,
    WorkspaceMemberUpdateRoleResponseSchema,
} from '@shared/api/workspaces';
import { getWorkspaceEntitlements } from '../../services/entitlements.js';
import { isWorkspaceAdmin } from '../../services/projectAccess.js';
import { syncSeatQuantity } from '../../services/seatBilling.js';

export const workspaceMemberUpdateRoleRoutes: FastifyPluginAsyncTypebox = async (app) => {
    app.post(
        '/workspace-member-update-role',
        {
            preHandler: app.requireUser,
            schema: {
                body: WorkspaceMemberUpdateRoleRequestSchema,
                response: {
                    200: WorkspaceMemberUpdateRoleResponseSchema,
                    403: Type.Object({ error: Type.String() }),
                    404: Type.Object({ error: Type.String() }),
                    409: Type.Object({ error: Type.String() }),
                },
            },
        },
        async (req, reply) => {
            const { workspaceId, userId: targetUserId, role } = req.body;
            const db = app.deps.db;
            req.logCtx.set({ 'workspace.id': workspaceId });

            if (!await isWorkspaceAdmin(db, workspaceId, req.user!.id)) {
                return reply.code(403).send({ error: 'Requires admin role in this workspace' });
            }

            const { rows: ownerRows } = await db.query(
                `SELECT owner_id AS "ownerId" FROM workspaces
                 WHERE id = $1 AND deleted_at IS NULL`,
                [workspaceId],
            );
            if ((ownerRows[0] as { ownerId: string } | undefined)?.ownerId === targetUserId) {
                return reply.code(409).send({ error: 'Cannot change the role of the workspace owner' });
            }

            // Current role decides whether this change crosses the billed
            // boundary — viewer↔(creator|admin) moves the seat count,
            // admin↔creator does not (both are seats). Revamp Step 6.
            const { rows: currentRows } = await db.query(
                `SELECT wm.role, u.email,
                        (SELECT name FROM user_profiles up WHERE up.user_id = wm.user_id) AS name
                 FROM workspace_members wm
                 JOIN auth.users u ON u.id = wm.user_id
                 WHERE wm.workspace_id = $1 AND wm.user_id = $2`,
                [workspaceId, targetUserId],
            );
            const current = currentRows[0] as
                | { role: 'viewer' | 'creator' | 'admin'; email: string; name: string | null }
                | undefined;
            if (!current) {
                return reply.code(404).send({ error: 'Member not found in workspace' });
            }

            const wasSeat = current.role !== 'viewer';
            const willBeSeat = role !== 'viewer';

            // Promotions grow the bill — same gate as inviting (a lapsed
            // workspace must not add billed seats).
            if (!wasSeat && willBeSeat) {
                const entitlements = await getWorkspaceEntitlements(
                    db, app.deps.clock, workspaceId,
                );
                if (!entitlements.canInvite) {
                    return reply
                        .code(403)
                        .send({ error: 'Promoting members requires an active subscription' });
                }
            }

            const { rowCount } = await db.query(
                `UPDATE workspace_members
                 SET role = $3, updated_at = now()
                 WHERE workspace_id = $1 AND user_id = $2`,
                [workspaceId, targetUserId, role],
            );
            if ((rowCount ?? 0) === 0) {
                return reply.code(404).send({ error: 'Member not found in workspace' });
            }

            if (wasSeat !== willBeSeat) {
                await syncSeatQuantity(app.deps, workspaceId, {
                    kind: 'role_changed',
                    memberEmail: current.email,
                    memberName: current.name,
                    role,
                }, req.log);
            }

            return { ok: true as const };
        },
    );
};
