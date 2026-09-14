/**
 * POST /stripe-checkout — ports the edge function of the same name
 * (Wave A #3). Single per-seat plan since billing revamp Step 1.
 *
 * Seat pre-purchase (plans/seat-prepurchase-oneshot.md): the caller
 * chooses how many seats to buy (`seats`, default = the seats already
 * in use). The floor is the current used count — a workspace
 * re-upgrading after a lapse keeps its members, so its checkout must
 * cover them (1 for the normal solo-owner upgrade). Caller must be
 * the OWNER of the workspace (billing mutations are owner-only).
 *
 * Kept for parity, flagged as a smell in the plan: userEmail is
 * client-supplied and forwarded to Stripe unchecked against the token's
 * email.
 *
 * Request:  { userId, userEmail, interval?, seats?, workspaceId, successUrl, cancelUrl }
 * Response: { url } | 400/403 { error }
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import { getSeatUsage } from '../../services/seatBilling.js';

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
                    /** Seats to buy; defaults to the seats currently in use */
                    seats: Type.Optional(Type.Integer({ minimum: 1 })),
                    workspaceId: Type.String({ minLength: 1 }),
                    successUrl: Type.String({ minLength: 1 }),
                    cancelUrl: Type.String({ minLength: 1 }),
                }),
                response: {
                    200: Type.Object({
                        url: Type.Union([Type.String(), Type.Null()]),
                    }),
                    400: Type.Object({ error: Type.String() }, { additionalProperties: true }),
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

            // Billing mutations are OWNER-only (same predicate as
            // /subscription-change and /stripe-portal): the subscription is
            // the owner's, admins manage people rather than the plan.
            const { rows: authzRows } = await app.deps.db.query(
                `SELECT 1 FROM workspaces w
                 WHERE w.id = $1
                   AND w.deleted_at IS NULL
                   AND w.owner_id = $2`,
                [workspaceId, req.user!.id],
            );
            if (authzRows.length === 0) {
                return reply.code(403).send({ error: 'Requires workspace ownership' });
            }

            const { used } = await getSeatUsage(app.deps.db, workspaceId);
            const seats = req.body.seats ?? used;
            if (seats < used) {
                return reply
                    .code(400)
                    .send({ error: `Checkout needs at least ${used} seats for the current members` });
            }

            const { url } = await app.deps.stripe.createCheckoutSession({
                customer_email: userEmail,
                client_reference_id: userId,
                price: priceIds[interval],
                quantity: seats,
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
