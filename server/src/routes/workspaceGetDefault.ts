/**
 * POST /workspace-get-default — the session bootstrap (Part 2 Batch 4).
 * Ports workspace_get_default's full heal chain inline:
 *   1. stored default_workspace_id, if still a live membership;
 *   2. else the caller's oldest owned live workspace;
 *   3. else CREATE 'My Workspace' + admin membership;
 *   4. heal user_profiles.default_workspace_id to whatever resolved;
 *   5. return the blob with the caller's role + subscription seats.
 * Guarantees a workspace exists — this response is never null. The SQL
 * fn ran the chain in one transaction; here a crash mid-chain leaves a
 * creatable-again state the next call heals (accepted, documented).
 *
 * Request:  {}
 * Response: { id, name, owner_id, role, seats, created_at, updated_at }
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';

export const workspaceGetDefaultRoutes: FastifyPluginAsyncTypebox = async (app) => {
    app.post(
        '/workspace-get-default',
        {
            preHandler: app.requireUser,
        },
        async (req, reply) => {
            const userId = req.user!.id;
            const db = app.deps.db;

            // 1+2. Stored default if the membership is still live
            const { rows: storedRows } = await db.query(
                `SELECT wm.workspace_id AS id
                 FROM user_profiles up
                 JOIN workspace_members wm ON wm.workspace_id = up.default_workspace_id
                                          AND wm.user_id = up.user_id
                 JOIN workspaces w ON w.id = wm.workspace_id
                 WHERE up.user_id = $1 AND w.deleted_at IS NULL`,
                [userId],
            );
            let workspaceId = (storedRows[0] as { id: string } | undefined)?.id ?? null;

            // 3. Oldest owned live workspace
            if (!workspaceId) {
                const { rows } = await db.query(
                    `SELECT w.id
                     FROM workspaces w
                     JOIN workspace_members wm ON wm.workspace_id = w.id AND wm.user_id = $1
                     WHERE w.owner_id = $1 AND w.deleted_at IS NULL
                     ORDER BY w.created_at ASC
                     LIMIT 1`,
                    [userId],
                );
                workspaceId = (rows[0] as { id: string } | undefined)?.id ?? null;
            }

            // 4. Bootstrap: brand-new user, no workspace at all
            if (!workspaceId) {
                const { rows } = await db.query(
                    `INSERT INTO workspaces (name, owner_id)
                     VALUES ('My Workspace', $1)
                     RETURNING id`,
                    [userId],
                );
                workspaceId = (rows[0] as { id: string }).id;
                await db.query(
                    `INSERT INTO workspace_members (workspace_id, user_id, role)
                     VALUES ($1, $2, 'admin')`,
                    [workspaceId, userId],
                );
            }
            req.logCtx.set({ 'workspace.id': workspaceId });

            // 5. Heal the stored default (unconditional, SQL parity)
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
                    'role',       wm.role,
                    'seats',      (SELECT s.seats FROM subscriptions s WHERE s.workspace_id = w.id LIMIT 1),
                    'created_at', w.created_at,
                    'updated_at', w.updated_at
                ) AS workspace
                FROM workspaces w
                JOIN workspace_members wm ON wm.workspace_id = w.id AND wm.user_id = $2
                WHERE w.id = $1`,
                [workspaceId, userId],
            );
            return reply.send((blobRows[0] as { workspace: unknown }).workspace);
        },
    );
};
