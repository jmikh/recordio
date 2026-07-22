/**
 * POST /stripe-webhooks — ports the edge function of the same name
 * (Wave D #17).
 *
 * Called by Stripe. Auth is the `stripe-signature` header, verified by
 * the stripe port (SDK constructEvent — HMAC + its default 300 s
 * timestamp tolerance) against the RAW request bytes; same SCOPED
 * string content-type parser as /mux-video-webhook.
 *
 * Divergences (user decisions 2026-07-22, both documented in the plan):
 * - Signature failures are 400 for BOTH cases (missing header /
 *   invalid signature). The edge fn 400'd the first but 500'd the
 *   second through its error boundary (+ a Sentry event per garbage
 *   signature). Stripe retries any non-2xx — behavior toward Stripe
 *   is identical.
 * - The webhook NEVER touches projects: the edge fn's
 *   `set_project_expiry` calls (clear on activation, +14 d on
 *   deactivation) are NOT ported — subscription changes no longer
 *   write projects.expires_at (pinned by tests). The SQL fn becomes
 *   an orphan once the edge endpoint is disabled (decommission list).
 *
 * Handlers (parity otherwise; idempotency is upsert-re-run safety plus
 * the `event.created` vs `stripe_event_at` ordering guard — NO
 * processed-events ledger, plan decision 2026-07-17):
 * - checkout.session.completed → metadata userId/workspaceId +
 *   subscription id (missing → THROW, Stripe retries) → retrieve the
 *   authoritative subscription from Stripe → UPSERT on workspace_id.
 *   Does NOT stamp stripe_event_at (parity).
 * - customer.subscription.created|updated → row by stripe_customer_id
 *   (unknown → THROW — covers this event racing ahead of
 *   checkout.completed; Stripe's retry resolves it) → discard
 *   out-of-order deliveries (200, warn) → UPDATE + stamp
 *   stripe_event_at.
 * - customer.subscription.deleted → status canceled, plan pro, seats
 *   NULL. NO ordering guard (parity smell, pinned): a stale
 *   redelivered deleted always cancels.
 * - anything else → 200 acknowledged.
 *
 * Response: { received: true }
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import type { FastifyRequest } from 'fastify';
import { logEvent } from '../logging.js';
import type {
    StripeCheckoutSession,
    StripeSubscription,
    StripeSubscriptionItem,
} from '../ports/stripe.js';

/** Read plan from price metadata. Throws if plan_type is missing or invalid. */
function planFromSubscription(subscription: StripeSubscription): 'pro' | 'teams' {
    const price = subscription.items?.data?.[0]?.price;
    const planType = typeof price === 'object' ? price?.metadata?.plan_type : undefined;
    if (planType !== 'pro' && planType !== 'teams') {
        const priceId = typeof price === 'object' ? price?.id : price;
        throw new Error(
            `Missing or invalid plan_type metadata on price ${priceId ?? 'unknown'}. Expected 'pro' or 'teams'.`,
        );
    }
    return planType;
}

function periodEndToIso(value: number | string | null | undefined): string | null {
    if (!value) return null;
    const d = typeof value === 'number' ? new Date(value * 1000) : new Date(value);
    return isNaN(d.getTime()) ? null : d.toISOString();
}

function itemPeriodEnd(sub: StripeSubscription, item: StripeSubscriptionItem | undefined): string | null {
    // This SDK version keeps current_period_end on the ITEM; older webhook
    // payload versions have it subscription-level — same fallback as the
    // edge fn
    return periodEndToIso(item?.current_period_end ?? sub.current_period_end);
}

export const stripeWebhooksRoutes: FastifyPluginAsyncTypebox = async (app) => {
    // Raw body for signature verification — scoped to this plugin's
    // encapsulation context, exactly like /mux-video-webhook (pinned by
    // an isolation test)
    app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
        done(null, body);
    });

    async function handleCheckoutCompleted(
        req: FastifyRequest,
        session: StripeCheckoutSession,
        eventType: string,
    ): Promise<void> {
        const userId = session.metadata?.userId || session.client_reference_id;
        const workspaceId = session.metadata?.workspaceId;
        const customerId = session.customer;
        const subscriptionId = session.subscription;

        // Throw → 500 → Stripe retries; a session without these can never
        // fill the row meaningfully
        if (!userId) throw new Error('checkout.session.completed missing userId');
        if (!workspaceId) throw new Error('checkout.session.completed missing workspaceId in metadata');
        if (!subscriptionId) throw new Error('checkout.session.completed missing subscriptionId');
        req.logCtx.set({ 'workspace.id': workspaceId });

        // Authoritative subscription data from Stripe — if this fails, let
        // it throw rather than upserting a half-correct row (parity)
        const stripeSub = await app.deps.stripe.getSubscription(subscriptionId);
        const item = stripeSub.items?.data?.[0];
        const price = typeof item?.price === 'object' ? item.price : undefined;
        const plan = planFromSubscription(stripeSub);
        const billingInterval = price?.recurring?.interval === 'year' ? 'yearly' : 'monthly';
        const seats = plan === 'teams' ? (item?.quantity ?? null) : null;

        await app.deps.db.query(
            `INSERT INTO subscriptions
                (workspace_id, user_id, stripe_customer_id, stripe_subscription_id,
                 status, plan, billing_interval, current_period_end,
                 cancel_at_period_end, seats, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false, $9, $10)
             ON CONFLICT (workspace_id) DO UPDATE SET
                user_id = EXCLUDED.user_id,
                stripe_customer_id = EXCLUDED.stripe_customer_id,
                stripe_subscription_id = EXCLUDED.stripe_subscription_id,
                status = EXCLUDED.status,
                plan = EXCLUDED.plan,
                billing_interval = EXCLUDED.billing_interval,
                current_period_end = EXCLUDED.current_period_end,
                cancel_at_period_end = EXCLUDED.cancel_at_period_end,
                seats = EXCLUDED.seats,
                updated_at = EXCLUDED.updated_at`,
            [
                workspaceId,
                userId,
                customerId,
                subscriptionId,
                stripeSub.status,
                plan,
                billingInterval,
                itemPeriodEnd(stripeSub, item),
                seats,
                app.deps.clock.now().toISOString(),
            ],
        );

        logEvent(req.log, 'subscription.changed', {
            'workspace.id': workspaceId,
            'stripe.event_type': eventType,
        });
    }

    async function handleSubscriptionUpdate(
        req: FastifyRequest,
        subscription: StripeSubscription,
        eventCreated: number,
        eventType: string,
    ): Promise<void> {
        const customerId = subscription.customer;

        const { rows } = await app.deps.db.query(
            'SELECT workspace_id, stripe_event_at FROM subscriptions WHERE stripe_customer_id = $1 LIMIT 1',
            [customerId],
        );
        const existing = rows[0] as { workspace_id: string; stripe_event_at: Date | null } | undefined;
        if (!existing) {
            // Usually this event racing ahead of checkout.completed —
            // Stripe's retry lands after the upsert (parity)
            throw new Error(`subscription update for unknown customer ${customerId}`);
        }
        req.logCtx.set({ 'workspace.id': existing.workspace_id });

        // Discard out-of-order delivery using Stripe's event timestamp
        const incomingAt = new Date(eventCreated * 1000);
        if (existing.stripe_event_at && incomingAt <= new Date(existing.stripe_event_at)) {
            req.log.warn(
                {
                    'workspace.id': existing.workspace_id,
                    incoming_at: incomingAt.toISOString(),
                    stored_at: new Date(existing.stripe_event_at).toISOString(),
                },
                'ignoring out-of-order stripe event',
            );
            return;
        }

        const item = subscription.items?.data?.[0];
        const plan = planFromSubscription(subscription);
        const seats = plan === 'teams' ? (item?.quantity ?? null) : null;
        const periodEnd = itemPeriodEnd(subscription, item);
        if (!periodEnd) {
            throw new Error(`Invalid current_period_end: ${item?.current_period_end}`);
        }

        await app.deps.db.query(
            `UPDATE subscriptions SET
                status = $2, plan = $3, current_period_end = $4,
                cancel_at_period_end = $5, seats = $6, stripe_event_at = $7,
                updated_at = $8
             WHERE stripe_customer_id = $1`,
            [
                customerId,
                subscription.status,
                plan,
                periodEnd,
                subscription.cancel_at_period_end ?? false,
                seats,
                incomingAt.toISOString(),
                app.deps.clock.now().toISOString(),
            ],
        );

        logEvent(req.log, 'subscription.changed', {
            'workspace.id': existing.workspace_id,
            'stripe.event_type': eventType,
        });
    }

    async function handleSubscriptionDeleted(
        req: FastifyRequest,
        subscription: StripeSubscription,
        eventCreated: number,
        eventType: string,
    ): Promise<void> {
        const customerId = subscription.customer;

        // Lookup only feeds the log event now (the edge fn read user_id
        // for the dropped expiry call); the UPDATE below is a no-op for
        // an unknown customer either way (parity: still 200)
        const { rows } = await app.deps.db.query(
            'SELECT workspace_id FROM subscriptions WHERE stripe_customer_id = $1 LIMIT 1',
            [customerId],
        );
        const existing = rows[0] as { workspace_id: string } | undefined;

        await app.deps.db.query(
            `UPDATE subscriptions SET
                status = 'canceled', plan = 'pro', seats = NULL,
                stripe_event_at = $2, updated_at = $3
             WHERE stripe_customer_id = $1`,
            [
                customerId,
                new Date(eventCreated * 1000).toISOString(),
                app.deps.clock.now().toISOString(),
            ],
        );

        if (existing) {
            req.logCtx.set({ 'workspace.id': existing.workspace_id });
            logEvent(req.log, 'subscription.changed', {
                'workspace.id': existing.workspace_id,
                'stripe.event_type': eventType,
            });
        }
    }

    app.post(
        '/stripe-webhooks',
        {
            schema: {
                response: {
                    200: Type.Object({ received: Type.Literal(true) }),
                    400: Type.Object({ error: Type.String() }),
                    500: Type.Object({ error: Type.String() }, { additionalProperties: true }),
                },
            },
        },
        async (req, reply) => {
            const signature = req.headers['stripe-signature'];
            if (typeof signature !== 'string') {
                req.logCtx.set({ error_type: 'StripeSignatureInvalid' });
                return reply.code(400).send({ error: 'No signature' });
            }

            const rawBody = req.body as string;
            let event;
            try {
                event = await app.deps.stripe.verifyWebhook(rawBody, signature);
            } catch (err) {
                // A missing webhookSecret is a deployment error, not a bad
                // caller — fail loudly instead of 400ing every event
                if (err instanceof Error && err.message.includes('not configured')) throw err;
                req.logCtx.set({ error_type: 'StripeSignatureInvalid' });
                return reply.code(400).send({ error: 'Invalid signature' });
            }
            req.logCtx.set({ 'stripe.event_type': event.type });

            switch (event.type) {
                case 'checkout.session.completed':
                    await handleCheckoutCompleted(
                        req,
                        event.data.object as StripeCheckoutSession,
                        event.type,
                    );
                    break;
                case 'customer.subscription.created':
                case 'customer.subscription.updated':
                    await handleSubscriptionUpdate(
                        req,
                        event.data.object as StripeSubscription,
                        event.created,
                        event.type,
                    );
                    break;
                case 'customer.subscription.deleted':
                    await handleSubscriptionDeleted(
                        req,
                        event.data.object as StripeSubscription,
                        event.created,
                        event.type,
                    );
                    break;
                // Unhandled types are acknowledged — stripe.event_type is
                // already on the canonical event
            }

            return { received: true as const };
        },
    );
};
