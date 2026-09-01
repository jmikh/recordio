/**
 * POST /workspace-list — every live workspace the caller belongs to,
 * with their role and subscription seats (Part 2 Batch 3). Ports
 * workspace_list inline. Object-wrapped `{ workspaces: [...] }` (the
 * SQL fn returned a bare array — RPC artifact); rows keep snake_case.
 * Ordering deliberately uses the COLUMNS (created_at ASC, name ASC) —
 * the fn text-compared the rendered timestamp (same smell as
 * project_list, fixed on the live path). Oldest-first is load-bearing:
 * the switcher shows the original workspace first.
 *
 * Request:  {} (empty body)
 * Response: { workspaces: [...] }
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';

export const workspaceListRoutes: FastifyPluginAsyncTypebox = async (app) => {
    app.post(
        '/workspace-list',
        {
            preHandler: app.requireUser,
        },
        async (req, reply) => {
            // Owner has no workspace_members row (revamp Step 2 — owner
            // is its own state, workspaces.owner_id): owned workspaces
            // come in via the LEFT JOIN with a synthesized admin role.
            const { rows } = await app.deps.db.query(
                `SELECT COALESCE(jsonb_agg(jsonb_build_object(
                    'id',         w.id,
                    'name',       w.name,
                    'owner_id',   w.owner_id,
                    'role',       CASE WHEN w.owner_id = $1 THEN 'admin' ELSE wm.role END,
                    'seats',      (SELECT s.seats FROM subscriptions s WHERE s.workspace_id = w.id LIMIT 1),
                    'created_at', w.created_at,
                    'updated_at', w.updated_at
                ) ORDER BY w.created_at ASC, w.name ASC), '[]'::jsonb) AS workspaces
                FROM workspaces w
                LEFT JOIN workspace_members wm ON wm.workspace_id = w.id AND wm.user_id = $1
                WHERE (w.owner_id = $1 OR wm.user_id IS NOT NULL)
                  AND w.deleted_at IS NULL`,
                [req.user!.id],
            );
            return reply.send({
                workspaces: (rows[0] as { workspaces: unknown[] }).workspaces,
            });
        },
    );
};
