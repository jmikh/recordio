/**
 * POST /subscription-change — ports the edge function of the same name
 * (Wave A #3, 3/3). First migrated route with a DB WRITE.
 *
 * Previews (dryRun) or applies a plan/seat/interval change on a workspace
 * subscription. Caller must be a workspace admin. Proration is
 * always_invoice: upgrades charge immediately, reductions credit the next
 * invoice. On apply, the DB row is updated immediately so the client's
 * refreshSubscription() reflects the change before the Stripe webhook
 * (which stays authoritative) syncs again.
 *
 * The edge fn's `subscription_workspace_get` RPC (SECURITY DEFINER, admin
 * check via assert_workspace_admin/auth.uid()) is EXCLUSIVE to that edge
 * fn — its logic is ported inline below and the SQL function becomes a
 * decommission-checklist orphan. Its 403/404 split is preserved: the RPC
 * raised PT403 for non-admin/deleted-workspace (edge fn → 403) but
 * returned NULL for admin-with-no-subscription (→ 404). The edge fn's
 * second, service-role read of the same subscriptions row is collapsed
 * into the same query — over the pg pool there is no user-vs-service-role
 * client split.
 *
 * Schema divergences (documented in the migration plan): newPlan is a
 * schema literal ('teams'), newSeats an integer >= 1, and dryRun is
 * REQUIRED — the edge fn treated a missing dryRun as falsy and silently
 * APPLIED the change; failing 400 beats defaulting to the destructive
 * branch. Business-rule 400s keep their exact edge-fn bodies.
 *
 * Request:  { workspaceId, newPlan, newSeats, newInterval?, dryRun }
 * Response: { immediateCharge, nextRenewalAmount, billingInterval,
 *             nextRenewalDate, currency }            (dryRun)
 *           { success, plan, seats, billingInterval } (apply)
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import type { StripePriceIds } from './stripeCheckout.js';

interface SubscriptionRow {
    /** NULL ⇔ no subscription row (LEFT JOIN miss) — status itself is NOT NULL */
    status: string | null;
    plan: string | null;
    billing_interval: string | null;
    seats: number | null;
    stripe_customer_id: string | null;
    stripe_subscription_id: string | null;
}

export interface SubscriptionChangeRoutesOptions {
    priceIds?: StripePriceIds;
}

export const subscriptionChangeRoutes: FastifyPluginAsyncTypebox<SubscriptionChangeRoutesOptions> = async (
    app,
    opts,
) => {
    app.post(
        '/subscription-change',
        {
            preHandler: app.requireUser,
            schema: {
                body: Type.Object({
                    workspaceId: Type.String({ minLength: 1 }),
                    newPlan: Type.Literal('teams'),
                    newSeats: Type.Integer({ minimum: 1 }),
                    newInterval: Type.Optional(
                        Type.Union([Type.Literal('monthly'), Type.Literal('yearly')]),
                    ),
                    dryRun: Type.Boolean(),
                }),
                response: {
                    200: Type.Union([
                        Type.Object({
                            immediateCharge: Type.Number(),
                            nextRenewalAmount: Type.Number(),
                            billingInterval: Type.String(),
                            nextRenewalDate: Type.String(),
                            currency: Type.String(),
                        }),
                        Type.Object({
                            success: Type.Literal(true),
                            plan: Type.String(),
                            seats: Type.Number(),
                            billingInterval: Type.String(),
                        }),
                    ]),
                    // additionalProperties keeps Fastify's default
                    // validation-400 body intact (statusCode/message pass
                    // through) while business-rule 400s send exact `{ error }`
                    // edge-fn bodies through the same serializer
                    400: Type.Object({ error: Type.String() }, { additionalProperties: true }),
                    403: Type.Object({ error: Type.String() }),
                    404: Type.Object({ error: Type.String() }),
                    500: Type.Object({ error: Type.String() }, { additionalProperties: true }),
                },
            },
        },
        async (req, reply) => {
            // Config is required at startup; this only fires in a test that
            // forgot to pass priceIds (same guard as stripe-checkout)
            const { priceIds } = opts;
            if (!priceIds) throw new Error('subscriptionChangeRoutes: priceIds not configured');

            const { workspaceId, newPlan, newSeats, newInterval, dryRun } = req.body;
            req.logCtx.set({
                'workspace.id': workspaceId,
                'stripe.plan': newPlan,
                'stripe.dry_run': dryRun,
            });

            // Admin check + subscription in one query, keeping the RPC's
            // 403/404 split: no row = not admin (or deleted workspace),
            // row with NULL status = admin but no subscription row.
            const { rows } = await app.deps.db.query(
                `SELECT s.status, s.plan, s.billing_interval, s.seats,
                        s.stripe_customer_id, s.stripe_subscription_id
                 FROM workspace_members wm
                 JOIN workspaces w
                     ON w.id = wm.workspace_id
                    AND w.deleted_at IS NULL
                 LEFT JOIN subscriptions s
                     ON s.workspace_id = wm.workspace_id
                 WHERE wm.workspace_id = $1
                   AND wm.user_id = $2
                   AND wm.role = 'admin'`,
                [workspaceId, req.user!.id],
            );
            const sub = rows[0] as SubscriptionRow | undefined;

            if (!sub) {
                return reply.code(403).send({ error: 'Unauthorized or subscription not found' });
            }
            if (sub.status === null) {
                return reply.code(404).send({ error: 'No subscription found for this workspace' });
            }
            if (!['active', 'trialing'].includes(sub.status)) {
                return reply.code(400).send({ error: 'Subscription is not active' });
            }

            // Interval downgrade not supported (yearly → monthly)
            if (newInterval && sub.billing_interval === 'yearly' && newInterval === 'monthly') {
                return reply
                    .code(400)
                    .send({ error: 'Downgrade from yearly to monthly billing is not supported' });
            }

            // No-op guard — same plan, same seats, same interval
            const targetInterval = (newInterval ?? sub.billing_interval ?? 'monthly') as
                | 'monthly'
                | 'yearly';
            req.logCtx.set({ 'stripe.interval': targetInterval });
            if (sub.plan === 'teams' && sub.seats === newSeats && sub.billing_interval === targetInterval) {
                return reply
                    .code(400)
                    .send({ error: 'No change in plan, seats, or billing interval' });
            }

            if (!sub.stripe_subscription_id || !sub.stripe_customer_id) {
                return reply
                    .code(404)
                    .send({ error: 'No Stripe subscription linked to this workspace' });
            }

            // Seat floor: never fewer seats than current members
            const { rows: countRows } = await app.deps.db.query(
                'SELECT COUNT(*)::int AS count FROM workspace_members WHERE workspace_id = $1',
                [workspaceId],
            );
            const memberCount = (countRows[0] as { count: number } | undefined)?.count ?? 1;
            if (newSeats < memberCount) {
                return reply.code(400).send({
                    error: `Cannot set fewer seats than current member count (${memberCount})`,
                });
            }

            const stripeSub = await app.deps.stripe.getSubscription(sub.stripe_subscription_id, {
                expandItemPrices: true,
            });
            const item = stripeSub.items?.data[0];
            if (!item) {
                return reply
                    .code(500)
                    .send({ error: 'No subscription item found on Stripe subscription' });
            }

            const billingInterval = (sub.billing_interval ?? 'monthly') as 'monthly' | 'yearly';
            const needsPriceChange = sub.plan !== newPlan || targetInterval !== billingInterval;
            const newPriceId = needsPriceChange ? priceIds[`${newPlan}_${targetInterval}`] : null;

            if (dryRun) {
                const preview = await app.deps.stripe.previewInvoice({
                    customer: sub.stripe_customer_id,
                    subscription: sub.stripe_subscription_id,
                    item: {
                        id: item.id,
                        quantity: newSeats,
                        ...(newPriceId ? { price: newPriceId } : {}),
                    },
                    proration_behavior: 'always_invoice',
                });

                // amount_due is the net immediate charge for the proration
                // invoice (filtering line items by `proration` is unreliable
                // for flexible-billing subscriptions — edge-fn finding)
                const immediateCharge = (preview.amount_due ?? 0) / 100;

                // Always retrieve the price explicitly: the expanded
                // item.price is unreliable for flexible-billing subscriptions
                const currentPriceId = typeof item.price === 'string' ? item.price : item.price?.id;
                const targetPriceId = newPriceId ?? currentPriceId;
                if (!targetPriceId) throw new Error('Stripe subscription item has no price');
                const targetPrice = await app.deps.stripe.getPrice(targetPriceId);
                const nextRenewalAmount = ((targetPrice.unit_amount ?? 0) * newSeats) / 100;

                // Our API version keeps current_period_end on the ITEM (the
                // edge fn's pinned 2024 version had it on the subscription)
                const periodEnd = item.current_period_end ?? stripeSub.current_period_end;
                if (!periodEnd) throw new Error('Stripe subscription has no current_period_end');

                return {
                    immediateCharge,
                    nextRenewalAmount,
                    // Parity: the edge fn reports the CURRENT interval even
                    // when previewing an interval change — smell, not fixed
                    billingInterval,
                    nextRenewalDate: new Date(periodEnd * 1000).toISOString(),
                    currency: preview.currency,
                };
            }

            await app.deps.stripe.updateSubscription(sub.stripe_subscription_id, {
                items: [
                    {
                        id: item.id,
                        quantity: newSeats,
                        ...(newPriceId ? { price: newPriceId } : {}),
                    },
                ],
                proration_behavior: 'always_invoice',
            });

            // Immediate DB sync so the client sees the change right away;
            // the Stripe webhook remains authoritative and re-syncs later
            await app.deps.db.query(
                `UPDATE subscriptions
                 SET plan = $2, seats = $3, billing_interval = $4, updated_at = now()
                 WHERE workspace_id = $1`,
                [workspaceId, newPlan, newSeats, targetInterval],
            );

            return {
                success: true as const,
                plan: newPlan,
                seats: newSeats,
                billingInterval: targetInterval,
            };
        },
    );
};
