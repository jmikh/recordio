/**
 * Real Stripe adapter — first landed with stripe-checkout (Wave A #3).
 *
 * Thin translation only (see server/README.md). Each method's first
 * consumer lands it: portal/subscription/price/invoice/webhook methods
 * arrive with stripe-portal, subscription-change and stripe-webhooks —
 * not speculatively here.
 */
import Stripe from 'stripe';
import type { StripePort, StripePrice } from '../ports/stripe.js';

export interface StripeAdapterConfig {
    secretKey: string;
    /**
     * Signing secret of the Stripe webhook ENDPOINT posting to
     * /stripe-webhooks (STRIPE_WEBHOOK_SECRET). Optional in the type so
     * tests can build the adapter without it; verifyWebhook throws when
     * absent.
     */
    webhookSecret?: string;
}

function mapPrice(price: Stripe.Price): StripePrice {
    return {
        id: price.id,
        unit_amount: price.unit_amount,
        metadata: price.metadata,
        recurring: price.recurring ? { interval: price.recurring.interval } : null,
    };
}

export function createStripeAdapter(config: StripeAdapterConfig): StripePort {
    // No apiVersion override: stripe-node sends the version it ships with
    // (currently 2026-06-24.dahlia), which its request/response types are
    // generated for. The edge functions pin 2024-11-20.acacia — a deliberate
    // divergence, recorded in the migration plan.
    const stripe = new Stripe(config.secretKey);

    return {
        async createCheckoutSession(params) {
            const session = await stripe.checkout.sessions.create({
                customer_email: params.customer_email,
                client_reference_id: params.client_reference_id,
                line_items: [{ price: params.price, quantity: params.quantity }],
                mode: 'subscription',
                success_url: params.success_url,
                cancel_url: params.cancel_url,
                metadata: params.metadata,
            });
            return { url: session.url };
        },
        async createPortalSession(params) {
            const session = await stripe.billingPortal.sessions.create({
                customer: params.customer,
                return_url: params.return_url,
            });
            return { url: session.url };
        },
        async getSubscription(id, opts) {
            const sub = await stripe.subscriptions.retrieve(
                id,
                opts?.expandItemPrices ? { expand: ['items.data.price'] } : {},
            );
            return {
                id: sub.id,
                status: sub.status,
                customer: typeof sub.customer === 'string' ? sub.customer : sub.customer.id,
                cancel_at: sub.cancel_at,
                // This API version keeps current_period_end on the item, not
                // the subscription (the edge fn's pinned 2024 version had it
                // subscription-level) — the port carries it on both
                items: {
                    data: sub.items.data.map((item) => ({
                        id: item.id,
                        quantity: item.quantity,
                        current_period_end: item.current_period_end,
                        price: item.price ? mapPrice(item.price) : undefined,
                    })),
                },
            };
        },
        async updateSubscription(id, params) {
            await stripe.subscriptions.update(id, {
                items: params.items,
                proration_behavior:
                    params.proration_behavior as Stripe.SubscriptionUpdateParams.ProrationBehavior,
            });
        },
        async getPrice(id) {
            return mapPrice(await stripe.prices.retrieve(id));
        },
        async previewInvoice(params) {
            const invoice = await stripe.invoices.createPreview({
                customer: params.customer,
                subscription: params.subscription,
                subscription_details: {
                    items: [
                        {
                            id: params.item.id,
                            quantity: params.item.quantity,
                            ...(params.item.price ? { price: params.item.price } : {}),
                        },
                    ],
                    proration_behavior:
                        params.proration_behavior as Stripe.InvoiceCreatePreviewParams.SubscriptionDetails.ProrationBehavior,
                },
            });
            return {
                amount_due: invoice.amount_due,
                subtotal: invoice.subtotal,
                total: invoice.total,
                currency: invoice.currency,
                lines: { data: invoice.lines.data as unknown as Array<Record<string, unknown>> },
            };
        },
        async verifyWebhook(rawBody, signature) {
            if (!config.webhookSecret) {
                throw new Error('StripeAdapter: webhookSecret not configured (STRIPE_WEBHOOK_SECRET)');
            }
            // The SDK checks the HMAC AND enforces its default 300 s
            // timestamp tolerance — deliberately kept (closes the
            // unlimited-replay smell the Mux webhook retains for parity)
            const event = await stripe.webhooks.constructEventAsync(
                rawBody,
                signature,
                config.webhookSecret,
            );
            return {
                id: event.id,
                type: event.type,
                created: event.created,
                data: { object: event.data.object },
            };
        },
    };
}
