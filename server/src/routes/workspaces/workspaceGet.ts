/**
 * POST /workspace-get — workspace details for the settings page
 * (Part 2 Batch 3). Ports workspace_get inline: any member of a live
 * workspace; blob with members, PENDING invitations, seats and the
 * caller's role (viewer_seats dropped in revamp Step 6 — no user-visible
 * viewer math). Snake_case jsonb shape kept — no response schema.
 *
 * DOCUMENTED DIVERGENCE (live-bug fix, suggested_changes 2026-07-25):
 * the SQL fn filters invitations on `expires_at > now()`, but the
 * no-expiry migration (20260513042717) nulled expires_at on every
 * pending invitation — NULL > now() is NULL, so the fn's list was
 * ALWAYS EMPTY. This port filters on status alone and drops the
 * expires_at field (nothing client-side reads it — it never arrived).
 *
 * Request:  { workspaceId }
 * Response: the details blob | null (deleted mid-flight) | 403 { error }
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { WorkspaceIdRequestSchema } from '@shared/api/workspaces';
import { isWorkspaceMember } from '../../services/projectAccess.js';

export const workspaceGetRoutes: FastifyPluginAsyncTypebox = async (app) => {
    app.post(
        '/workspace-get',
        {
            preHandler: app.requireUser,
            // No response schemas — the 200 is a jsonb blob passthrough
            schema: {
                body: WorkspaceIdRequestSchema,
            },
        },
        async (req, reply) => {
            const { workspaceId } = req.body;
            const userId = req.user!.id;
            req.logCtx.set({ 'workspace.id': workspaceId });

            if (!await isWorkspaceMember(app.deps.db, workspaceId, userId)) {
                return reply.code(403).send({ error: 'Requires membership in this workspace' });
            }

            const { rows } = await app.deps.db.query(
                `SELECT jsonb_build_object(
                    'id',          w.id,
                    'name',        w.name,
                    'owner_id',    w.owner_id,
                    'role',        CASE WHEN w.owner_id = $2 THEN 'admin' ELSE (
                        SELECT wm2.role FROM workspace_members wm2
                        WHERE wm2.workspace_id = w.id AND wm2.user_id = $2
                    ) END,
                    'seats',       (
                        SELECT s.seats FROM subscriptions s
                        WHERE s.workspace_id = w.id LIMIT 1
                    ),
                    'members',     (
                        -- Owner first, synthesized (no workspace_members
                        -- row since revamp Step 2); member since creation.
                        -- The owner_id filter below guards against stale
                        -- pre-Step-2 owner rows, which would duplicate
                        -- the owner and inflate seat counts.
                        SELECT jsonb_build_array(jsonb_build_object(
                            'user_id',    w.owner_id,
                            'role',       'admin',
                            'email',      (SELECT u.email FROM auth.users u WHERE u.id = w.owner_id),
                            'name',       (SELECT name FROM user_profiles WHERE user_id = w.owner_id),
                            'created_at', w.created_at
                        )) || (
                            SELECT COALESCE(jsonb_agg(jsonb_build_object(
                                'user_id',    wm.user_id,
                                'role',       wm.role,
                                'email',      u.email,
                                'name',       (SELECT name FROM user_profiles WHERE user_id = wm.user_id),
                                'created_at', wm.created_at
                            ) ORDER BY wm.created_at ASC), '[]'::jsonb)
                            FROM workspace_members wm
                            JOIN auth.users u ON u.id = wm.user_id
                            WHERE wm.workspace_id = w.id
                              AND wm.user_id <> w.owner_id
                        )
                    ),
                    'invitations',  (
                        SELECT COALESCE(jsonb_agg(jsonb_build_object(
                            'id',         wi.id,
                            'email',      wi.email,
                            'role',       wi.role,
                            'invited_by', wi.invited_by,
                            'created_at', wi.created_at
                        ) ORDER BY wi.created_at ASC), '[]'::jsonb)
                        FROM workspace_invitations wi
                        WHERE wi.workspace_id = w.id
                          AND wi.status = 'pending'
                    ),
                    'created_at',  w.created_at,
                    'updated_at',  w.updated_at
                ) AS workspace
                FROM workspaces w
                WHERE w.id = $1 AND w.deleted_at IS NULL`,
                [workspaceId, userId],
            );
            return reply.send((rows[0] as { workspace: unknown } | undefined)?.workspace ?? null);
        },
    );
};
