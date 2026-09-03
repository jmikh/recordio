/**
 * POST /stripe-checkout — ports the edge function of the same name
 * (Wave A #3). Single per-seat plan since billing revamp Step 1
 * (plans/workspace-billing-revamp/workspace-billing-revamp-step-1.md).
 *
 * Revamp Step 6: caller must be admin-or-owner of the workspace (the
 * "workspaceId never checked" smell closed — any authenticated user
 * could previously start a checkout against any workspace), and
 * quantity is the COMPUTED billed-seat count, not a hardcoded 1 — a
 * workspace re-upgrading after a lapse keeps its members (Step 7 rule),
 * so its checkout must start at the real count (1 for the normal
 * solo-owner upgrade).
 *
 * Kept for parity, flagged as a smell in the plan: userEmail is
 * client-supplied and forwarded to Stripe unchecked against the token's
 * email.
 *
 * Request:  { userId, userEmail, interval?, workspaceId, successUrl, cancelUrl }
 * Response: { url }
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import { computeBilledSeats } from '../../services/seatBilling.js';

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

            // Billing mutations are admin/owner-only (revamp Step 6 —
            // same predicate as /subscription-change).
            const { rows: authzRows } = await app.deps.db.query(
                `SELECT 1 FROM workspaces w
                 WHERE w.id = $1
                   AND w.deleted_at IS NULL
                   AND (
                       w.owner_id = $2
                       OR EXISTS (
                           SELECT 1 FROM workspace_members wm
                           WHERE wm.workspace_id = w.id
                             AND wm.user_id = $2
                             AND wm.role = 'admin'
                       )
                   )`,
                [workspaceId, req.user!.id],
            );
            if (authzRows.length === 0) {
                return reply.code(403).send({ error: 'Requires admin role in this workspace' });
            }

            const { url } = await app.deps.stripe.createCheckoutSession({
                customer_email: userEmail,
                client_reference_id: userId,
                price: priceIds[interval],
                quantity: await computeBilledSeats(app.deps.db, workspaceId),
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
