/**
 * POST /workspace-get-default — the session bootstrap (Part 2 Batch 4).
 * Every account owns a workspace from signup (revamp Step 2 — the
 * on_user_signup_bootstrap trigger; existing users were backfilled by
 * migration 20260901131117), so this only resolves, never creates:
 *   1. stored default_workspace_id, if still owned or a live membership;
 *   2. else the caller's oldest owned live workspace;
 *   3. heal user_profiles.default_workspace_id to whatever resolved;
 *   4. return the blob with the caller's role + subscription seats.
 * No owned workspace at all is a signup-bootstrap invariant violation
 * → 500, loud (the old create-if-missing branch is gone).
 *
 * Request:  {}
 * Response: { id, name, owner_id, role, seats, created_at, updated_at }
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { resolveDefaultWorkspaceId } from '../../services/defaultWorkspace.js';

export const workspaceGetDefaultRoutes: FastifyPluginAsyncTypebox = async (app) => {
    app.post(
        '/workspace-get-default',
        {
            preHandler: app.requireUser,
        },
        async (req, reply) => {
            const userId = req.user!.id;
            const db = app.deps.db;

            // 1. Stored default if still owned or a live membership,
            //    2. else the oldest owned live workspace (shared with
            //    /project-clone, which resolves this for another user)
            const workspaceId = await resolveDefaultWorkspaceId(db, userId);

            if (!workspaceId) {
                req.log.error({ 'user.id': userId }, 'user owns no workspace — signup bootstrap invariant violated');
                return reply.code(500).send({ error: 'No workspace for this account' });
            }
            req.logCtx.set({ 'workspace.id': workspaceId });

            // 3. Heal the stored default (unconditional, SQL parity)
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
                    'role',       CASE WHEN w.owner_id = $2 THEN 'admin' ELSE wm.role END,
                    'seats',      (SELECT s.seats FROM subscriptions s WHERE s.workspace_id = w.id LIMIT 1),
                    'created_at', w.created_at,
                    'updated_at', w.updated_at
                ) AS workspace
                FROM workspaces w
                LEFT JOIN workspace_members wm ON wm.workspace_id = w.id AND wm.user_id = $2
                WHERE w.id = $1`,
                [workspaceId, userId],
            );
            return reply.send((blobRows[0] as { workspace: unknown }).workspace);
        },
    );
};
