/**
 * Real Stripe adapter — first landed with stripe-checkout (Wave A #3).
 *
 * Thin translation only (see server/README.md). Each method's first
 * consumer lands it: portal/subscription/price/invoice/webhook methods
 * arrive with stripe-portal, subscription-change and stripe-webhooks —
 * not speculatively here.
 */
import Stripe from 'stripe';
import type { StripePort } from '../ports/stripe.js';

export interface StripeAdapterConfig {
    secretKey: string;
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
        async createPortalSession() {
            throw new Error('stripe.createPortalSession: lands with stripe-portal');
        },
        async getSubscription() {
            throw new Error('stripe.getSubscription: lands with stripe-portal / subscription-change');
        },
        async updateSubscription() {
            throw new Error('stripe.updateSubscription: lands with subscription-change');
        },
        async getPrice() {
            throw new Error('stripe.getPrice: lands with subscription-change');
        },
        async previewInvoice() {
            throw new Error('stripe.previewInvoice: lands with subscription-change');
        },
        async verifyWebhook() {
            throw new Error('stripe.verifyWebhook: lands with stripe-webhooks');
        },
    };
}
