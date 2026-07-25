/**
 * POST /stripe-portal — ports the edge function of the same name
 * (Wave A #3, 2/3).
 *
 * Creates a Stripe billing-portal session for the workspace's subscription
 * and returns its URL.
 *
 * The edge function called the `subscription_get` RPC (SECURITY DEFINER,
 * membership via `auth.uid()`). That SQL function stays untouched — it is
 * shared with client RPCs and the unmigrated `transcribe` edge fn — but it
 * cannot be called over the server's pg pool: `auth.uid()` is NULL without
 * JWT claims, so it would return NULL for everyone. The membership-checked
 * lookup is ported inline with an explicit user id param instead. The RPC's
 * `p_workspace_id NULL` fallback (oldest owned workspace) is not ported —
 * the edge fn 400s without workspaceId, so that branch never ran here.
 *
 * Parity: non-member and no-subscription are indistinguishable (the RPC
 * returned NULL for both) — both get the exact 404 body below. A
 * subscription row with a NULL stripe_customer_id also 404s (edge fn's
 * `!sub?.stripe_customer_id`).
 *
 * Request:  { returnUrl, workspaceId }
 * Response: { url }
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';

interface SubscriptionRow {
    stripe_customer_id: string | null;
}

export const stripePortalRoutes: FastifyPluginAsyncTypebox = async (app) => {
    app.post(
        '/stripe-portal',
        {
            preHandler: app.requireUser,
            schema: {
                body: Type.Object({
                    returnUrl: Type.String({ minLength: 1 }),
                    workspaceId: Type.String({ minLength: 1 }),
                }),
                response: {
                    200: Type.Object({ url: Type.String() }),
                    404: Type.Object({ error: Type.String() }),
                },
            },
        },
        async (req, reply) => {
            const { returnUrl, workspaceId } = req.body;
            req.logCtx.set({ 'workspace.id': workspaceId });

            // Same membership semantics as subscription_get, with the
            // caller's id passed explicitly instead of auth.uid()
            const { rows } = await app.deps.db.query(
                `SELECT s.stripe_customer_id
                 FROM subscriptions s
                 JOIN workspace_members wm
                     ON wm.workspace_id = s.workspace_id
                    AND wm.user_id = $2
                 WHERE s.workspace_id = $1
                 LIMIT 1`,
                [workspaceId, req.user!.id],
            );
            const customerId = (rows[0] as SubscriptionRow | undefined)?.stripe_customer_id;

            if (!customerId) {
                return reply.code(404).send({ error: 'No subscription found for this workspace' });
            }

            const { url } = await app.deps.stripe.createPortalSession({
                customer: customerId,
                return_url: returnUrl,
            });

            return { url };
        },
    );
};
