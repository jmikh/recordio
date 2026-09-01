/**
 * POST /subscription-get — the workspace's subscription + entitlements
 * (billing revamp Step 1,
 * plans/workspace-billing-revamp/workspace-billing-revamp-step-1.md).
 *
 * Members always get entitlements: a free/trial workspace is
 * `subscription: null` + real entitlements. Non-members get 403 — the
 * pre-revamp null-for-non-member information hiding can't carry an
 * entitlements payload. workspaceId OMITTED falls back to the caller's
 * oldest OWNED live workspace (SQL parity); no workspace resolves →
 * 404 (a bootstrapped user always has one via workspace-get-default).
 *
 * Request:  { workspaceId? } — omit for the fallback, never null
 * Response: { subscription, entitlements } | 403/404 { error }
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { SubscriptionGetRequestSchema } from '@shared/api/session';
import { getWorkspaceEntitlements } from '../../services/entitlements.js';

export const subscriptionGetRoutes: FastifyPluginAsyncTypebox = async (app) => {
    app.post(
        '/subscription-get',
        {
            preHandler: app.requireUser,
            schema: {
                body: SubscriptionGetRequestSchema,
            },
        },
        async (req, reply) => {
            const workspaceId = req.body.workspaceId ?? null;
            const userId = req.user!.id;
            if (workspaceId) req.logCtx.set({ 'workspace.id': workspaceId });

            const { rows } = await app.deps.db.query(
                `SELECT w.id AS workspace_id,
                        (w.owner_id = $1 OR EXISTS (
                            SELECT 1 FROM workspace_members wm
                            WHERE wm.workspace_id = w.id AND wm.user_id = $1
                        )) AS is_member,
                        (SELECT jsonb_build_object(
                            'status',             s.status,
                            'current_period_end', s.current_period_end,
                            'cancel_at',          s.cancel_at,
                            'stripe_customer_id', s.stripe_customer_id,
                            'billing_interval',   s.billing_interval,
                            'seats',              s.seats
                        ) FROM subscriptions s WHERE s.workspace_id = w.id) AS subscription
                 FROM workspaces w
                 WHERE w.id = COALESCE(
                     $2::uuid,
                     (SELECT w2.id FROM workspaces w2
                      WHERE w2.owner_id = $1 AND w2.deleted_at IS NULL
                      ORDER BY w2.created_at ASC
                      LIMIT 1)
                 )
                   AND w.deleted_at IS NULL`,
                [userId, workspaceId],
            );
            const row = rows[0] as
                | { workspace_id: string; is_member: boolean; subscription: unknown }
                | undefined;

            if (!row) {
                return reply.code(404).send({ error: 'Workspace not found' });
            }
            if (!row.is_member) {
                return reply.code(403).send({ error: 'Not a member of this workspace' });
            }

            const entitlements = await getWorkspaceEntitlements(
                app.deps.db,
                app.deps.clock,
                row.workspace_id,
            );

            return reply.send({
                subscription: row.subscription ?? null,
                entitlements,
            });
        },
    );
};
