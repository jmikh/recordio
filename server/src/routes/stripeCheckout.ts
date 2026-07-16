/**
 * POST /stripe-checkout — ports the edge function of the same name
 * (Wave A #3).
 *
 * Creates a Stripe checkout session for Pro or Teams subscriptions and
 * returns its URL. No DB access — auth + price lookup + one Stripe call.
 *
 * Kept for parity, flagged as smells in the plan: userEmail is
 * client-supplied and forwarded to Stripe unchecked against the token's
 * email; workspaceId is never checked against the caller's membership;
 * seats has no upper bound.
 *
 * Request:  { userId, userEmail, plan?, interval?, workspaceId, seats?, successUrl, cancelUrl }
 * Response: { url }
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';

/** Env-configured Stripe price ids, keyed by `${plan}_${interval}`. */
export interface StripePriceIds {
    pro_monthly: string;
    pro_yearly: string;
    teams_monthly: string;
    teams_yearly: string;
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
                    plan: Type.Optional(
                        Type.Union([Type.Literal('pro'), Type.Literal('teams')]),
                    ),
                    interval: Type.Optional(
                        Type.Union([Type.Literal('monthly'), Type.Literal('yearly')]),
                    ),
                    workspaceId: Type.String({ minLength: 1 }),
                    seats: Type.Optional(Type.Number()),
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

            // Same defaults as the edge function's destructuring
            const {
                userId,
                userEmail,
                plan = 'pro',
                interval = 'yearly',
                workspaceId,
                seats = 5,
                successUrl,
                cancelUrl,
            } = req.body;

            req.logCtx.set({
                'workspace.id': workspaceId,
                'stripe.plan': plan,
                'stripe.interval': interval,
            });

            if (userId !== req.user!.id) {
                return reply.code(403).send({ error: 'Unauthorized: User ID mismatch' });
            }

            const quantity = plan === 'teams' ? Math.max(1, seats) : 1;

            const { url } = await app.deps.stripe.createCheckoutSession({
                customer_email: userEmail,
                client_reference_id: userId,
                price: priceIds[`${plan}_${interval}`],
                quantity,
                success_url: successUrl,
                cancel_url: cancelUrl,
                metadata: {
                    userId,
                    workspaceId,
                    plan,
                    interval,
                    seats: String(quantity),
                },
            });

            return { url };
        },
    );
};
