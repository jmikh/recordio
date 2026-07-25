/**
 * POST /subscription-get — the workspace's subscription (Part 2
 * Batch 4). Ports subscription_get inline: member-gated via the JOIN
 * (non-members get null, indistinguishable from no-subscription — SQL
 * parity, information hiding); workspaceId OMITTED falls back to the
 * caller's oldest OWNED live workspace; no subscription → null (the
 * client resets to the free plan). Blob shape kept — no response
 * schema.
 *
 * NOT consolidated with the Part 1 inline status reads
 * (projectCreateV2: active|past_due, no member gate; transcribe:
 * active|trialing) — one-line queries with deliberately different
 * policies (see suggested_changes' subscription-status-inconsistency
 * bullet); a shared helper would blur them.
 *
 * Request:  { workspaceId? } — omit for the fallback, never null
 * Response: the subscription blob | null
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { SubscriptionGetRequestSchema } from '@shared/api/session';

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
                `SELECT jsonb_build_object(
                    'status',             s.status,
                    'plan',               s.plan,
                    'current_period_end', s.current_period_end,
                    'cancel_at',          s.cancel_at,
                    'stripe_customer_id', s.stripe_customer_id,
                    'billing_interval',   s.billing_interval,
                    'seats',              s.seats
                ) AS subscription
                FROM subscriptions s
                JOIN workspace_members wm
                    ON wm.workspace_id = s.workspace_id
                   AND wm.user_id = $1
                WHERE s.workspace_id = COALESCE(
                    $2::uuid,
                    (SELECT w.id FROM workspaces w
                     WHERE w.owner_id = $1 AND w.deleted_at IS NULL
                     ORDER BY w.created_at ASC
                     LIMIT 1)
                )
                LIMIT 1`,
                [userId, workspaceId],
            );
            return reply.send(
                (rows[0] as { subscription: unknown } | undefined)?.subscription ?? null,
            );
        },
    );
};
