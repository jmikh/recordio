/**
 * POST /stripe-checkout — ports the edge function of the same name
 * (Wave A #3). Single per-seat plan since billing revamp Step 1
 * (plans/workspace-billing-revamp/workspace-billing-revamp-step-1.md):
 * no plan/seats in the request, quantity is always 1 — the owner buys
 * their own seat; invite-driven seat auto-scaling lands in Step 6.
 *
 * Creates a Stripe checkout session and returns its URL. No DB access
 * — auth + price lookup + one Stripe call.
 *
 * Kept for parity, flagged as smells in the plan: userEmail is
 * client-supplied and forwarded to Stripe unchecked against the token's
 * email; workspaceId is never checked against the caller's membership.
 *
 * Request:  { userId, userEmail, interval?, workspaceId, successUrl, cancelUrl }
 * Response: { url }
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';

/** Env-configured Stripe price ids of the single per-seat plan. */
export interface StripePriceIds {
    monthly: string;
    yearly: string;
}

export interface StripeCheckoutRoutesOptions {
    priceIds?: StripePriceIds;
}

export const stripeCheckoutRoutes: FastifyPluginAsyncTypebox<StripeCheckoutRoutesOptions> = async (
    app,
    opts,
) => {
    app.post(
        '/stripe-checkout',
        {
            preHandler: app.requireUser,
            schema: {
                body: Type.Object({
                    userId: Type.String({ minLength: 1 }),
                    userEmail: Type.String({ minLength: 1 }),
                    interval: Type.Optional(
                        Type.Union([Type.Literal('monthly'), Type.Literal('yearly')]),
                    ),
                    workspaceId: Type.String({ minLength: 1 }),
                    successUrl: Type.String({ minLength: 1 }),
                    cancelUrl: Type.String({ minLength: 1 }),
                }),
                response: {
                    200: Type.Object({
                        url: Type.Union([Type.String(), Type.Null()]),
                    }),
                    403: Type.Object({ error: Type.String() }),
                },
            },
        },
        async (req, reply) => {
            // Config is required at startup, so this only fires in a test
            // that forgot to pass priceIds — fail loudly, not with a bad session.
            const { priceIds } = opts;
            if (!priceIds) throw new Error('stripeCheckoutRoutes: priceIds not configured');

            const {
                userId,
                userEmail,
                interval = 'yearly',
                workspaceId,
                successUrl,
                cancelUrl,
            } = req.body;

            req.logCtx.set({
                'workspace.id': workspaceId,
                'stripe.interval': interval,
            });

            if (userId !== req.user!.id) {
                return reply.code(403).send({ error: 'Unauthorized: User ID mismatch' });
            }

            const { url } = await app.deps.stripe.createCheckoutSession({
                customer_email: userEmail,
                client_reference_id: userId,
                price: priceIds[interval],
                quantity: 1,
                success_url: successUrl,
                cancel_url: cancelUrl,
                metadata: {
                    userId,
                    workspaceId,
                    interval,
                },
            });

            return { url };
        },
    );
};
