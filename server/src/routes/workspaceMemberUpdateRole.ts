/**
 * POST /workspace-member-update-role — changes a member's role
 * (Part 2 Batch 3). Ports workspace_member_update_role inline:
 * admin-only; the owner's role is locked; role enum via the schema
 * (replaces the 'Invalid role' RAISE).
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
import { isWorkspaceAdmin } from '../services/projectAccess.js';

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

            const { rowCount } = await db.query(
                `UPDATE workspace_members
                 SET role = $3, updated_at = now()
                 WHERE workspace_id = $1 AND user_id = $2`,
                [workspaceId, targetUserId, role],
            );
            if ((rowCount ?? 0) === 0) {
                return reply.code(404).send({ error: 'Member not found in workspace' });
            }

            return { ok: true as const };
        },
    );
};
