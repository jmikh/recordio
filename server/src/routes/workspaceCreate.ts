/**
 * POST /workspace-create — creates a workspace with the caller as its
 * admin member and makes it their default (Part 2 Batch 3). Ports
 * workspace_create inline: three writes in the SQL fn's order
 * (workspace, membership, default_workspace_id) — the fn ran them in
 * one transaction; here a crash between writes can orphan a workspace
 * row (accepted, documented; workspace_get_default heals the default).
 *
 * Request:  { name }
 * Response: { id, name, owner_id, role: 'admin', created_at, updated_at }
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { WorkspaceCreateRequestSchema } from '@shared/api/workspaces';

export const workspaceCreateRoutes: FastifyPluginAsyncTypebox = async (app) => {
    app.post(
        '/workspace-create',
        {
            preHandler: app.requireUser,
            schema: {
                body: WorkspaceCreateRequestSchema,
            },
        },
        async (req, reply) => {
            const userId = req.user!.id;
            const db = app.deps.db;

            const { rows } = await db.query(
                `INSERT INTO workspaces (name, owner_id)
                 VALUES ($1, $2)
                 RETURNING id`,
                [req.body.name, userId],
            );
            const workspaceId = (rows[0] as { id: string }).id;
            req.logCtx.set({ 'workspace.id': workspaceId });

            await db.query(
                `INSERT INTO workspace_members (workspace_id, user_id, role)
                 VALUES ($1, $2, 'admin')`,
                [workspaceId, userId],
            );
            await db.query(
                `UPDATE user_profiles
                 SET default_workspace_id = $1, updated_at = now()
                 WHERE user_id = $2`,
                [workspaceId, userId],
            );

            const { rows: blobRows } = await db.query(
                `SELECT jsonb_build_object(
                    'id',         w.id,
                    'name',       w.name,
                    'owner_id',   w.owner_id,
                    'role',       'admin',
                    'created_at', w.created_at,
                    'updated_at', w.updated_at
                ) AS workspace
                FROM workspaces w WHERE w.id = $1`,
                [workspaceId],
            );
            return reply.send((blobRows[0] as { workspace: unknown }).workspace);
        },
    );
};
