/**
 * POST /workspace-member-remove — removes a member, transferring their
 * projects in this workspace to the CALLING admin (Part 2 Batch 3).
 * Ports workspace_member_remove inline in the SQL fn's write order:
 * transfer live projects → strip the member's project_editors rows in
 * this workspace → delete the membership. Owner unremovable; missing
 * member errors AFTER the transfer, SQL parity (the fn ran in one
 * transaction so nothing persisted — here the transfer of a
 * no-longer-member's projects would persist; unreachable in practice
 * because the UI lists only actual members).
 *
 * Request:  { workspaceId, userId }
 * Response: { transferredCount } | 403/404/409 { error }
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import {
    WorkspaceMemberRemoveRequestSchema,
    WorkspaceMemberRemoveResponseSchema,
} from '@shared/api/workspaces';
import { isWorkspaceAdmin } from '../services/projectAccess.js';

export const workspaceMemberRemoveRoutes: FastifyPluginAsyncTypebox = async (app) => {
    app.post(
        '/workspace-member-remove',
        {
            preHandler: app.requireUser,
            schema: {
                body: WorkspaceMemberRemoveRequestSchema,
                response: {
                    200: WorkspaceMemberRemoveResponseSchema,
                    403: Type.Object({ error: Type.String() }),
                    404: Type.Object({ error: Type.String() }),
                    409: Type.Object({ error: Type.String() }),
                },
            },
        },
        async (req, reply) => {
            const { workspaceId, userId: targetUserId } = req.body;
            const callerId = req.user!.id;
            const db = app.deps.db;
            req.logCtx.set({ 'workspace.id': workspaceId });

            if (!await isWorkspaceAdmin(db, workspaceId, callerId)) {
                return reply.code(403).send({ error: 'Requires admin role in this workspace' });
            }

            const { rows: ownerRows } = await db.query(
                `SELECT owner_id AS "ownerId" FROM workspaces
                 WHERE id = $1 AND deleted_at IS NULL`,
                [workspaceId],
            );
            if ((ownerRows[0] as { ownerId: string } | undefined)?.ownerId === targetUserId) {
                return reply.code(409).send({ error: 'Cannot remove the workspace owner' });
            }

            const { rowCount: transferredCount } = await db.query(
                `UPDATE projects SET owner_id = $3
                 WHERE workspace_id = $1 AND owner_id = $2 AND deleted_at IS NULL`,
                [workspaceId, targetUserId, callerId],
            );
            await db.query(
                `DELETE FROM project_editors pe
                 USING projects p
                 WHERE pe.project_id = p.id
                   AND p.workspace_id = $1
                   AND pe.user_id = $2`,
                [workspaceId, targetUserId],
            );
            const { rowCount: removed } = await db.query(
                `DELETE FROM workspace_members
                 WHERE workspace_id = $1 AND user_id = $2`,
                [workspaceId, targetUserId],
            );
            if ((removed ?? 0) === 0) {
                return reply.code(404).send({ error: 'Member not found in workspace' });
            }

            return { transferredCount: transferredCount ?? 0 };
        },
    );
};
