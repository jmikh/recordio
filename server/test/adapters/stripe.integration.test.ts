/**
 * Integration test for the real Stripe adapter against Stripe TEST MODE.
 * Third-party tier (like the S3 adapter test): needs a real credential, so
 * it stays out of the blocking CI job and auto-skips without env. Run it
 * manually with a test-mode key:
 *
 *   STRIPE_SECRET_KEY=sk_test_... npx vitest run server/test/adapters/stripe
 *
 * Guarded on the sk_test_ prefix so a live key can never be exercised from
 * tests. Creates a throwaway product/price per run (test-mode clutter only).
 */
import Stripe from 'stripe';
import { describe, expect, it } from 'vitest';
import { createStripeAdapter } from '../../src/adapters/stripe.js';

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const hasTestModeKey = Boolean(STRIPE_SECRET_KEY?.startsWith('sk_test_'));

describe.runIf(hasTestModeKey)('stripe adapter (Stripe test mode)', () => {
    it('createCheckoutSession returns a checkout.stripe.com URL', async () => {
        const stripe = new Stripe(STRIPE_SECRET_KEY!);
        const price = await stripe.prices.create({
            currency: 'usd',
            unit_amount: 500,
            recurring: { interval: 'month' },
            product_data: { name: 'adapter-integration-test' },
        });

        const adapter = createStripeAdapter({ secretKey: STRIPE_SECRET_KEY! });
        const { url } = await adapter.createCheckoutSession({
            customer_email: 'adapter-test@example.com',
            client_reference_id: 'adapter-test-user',
            price: price.id,
            quantity: 2,
            success_url: 'https://example.com/success',
            cancel_url: 'https://example.com/cancel',
            metadata: { userId: 'adapter-test-user', workspaceId: 'adapter-test-ws' },
        });

        expect(url).toMatch(/^https:\/\/checkout\.stripe\.com\//);
    });

    it('createPortalSession returns a billing.stripe.com URL', async () => {
        const stripe = new Stripe(STRIPE_SECRET_KEY!);
        const customer = await stripe.customers.create({
            email: 'adapter-test@example.com',
            description: 'adapter-integration-test',
        });

        const adapter = createStripeAdapter({ secretKey: STRIPE_SECRET_KEY! });
        const { url } = await adapter.createPortalSession({
            customer: customer.id,
            return_url: 'https://example.com/billing',
        });

        expect(url).toMatch(/^https:\/\/billing\.stripe\.com\//);
    });

    it('getSubscription / previewInvoice / getPrice / updateSubscription round-trip', async () => {
        const stripe = new Stripe(STRIPE_SECRET_KEY!);
        const customer = await stripe.customers.create({
            email: 'adapter-test@example.com',
            description: 'adapter-integration-test',
        });
        const price = await stripe.prices.create({
            currency: 'usd',
            unit_amount: 700,
            recurring: { interval: 'month' },
            product_data: { name: 'adapter-integration-test-sub' },
        });
        // Trialing subscription — needs no payment method
        const created = await stripe.subscriptions.create({
            customer: customer.id,
            items: [{ price: price.id, quantity: 2 }],
            trial_period_days: 30,
        });

        const adapter = createStripeAdapter({ secretKey: STRIPE_SECRET_KEY! });

        const sub = await adapter.getSubscription(created.id, { expandItemPrices: true });
        expect(sub.status).toBe('trialing');
        expect(sub.customer).toBe(customer.id);
        const item = sub.items!.data[0];
        expect(item.quantity).toBe(2);
        expect((item.price as { id: string }).id).toBe(price.id);
        // Our API version keeps current_period_end on the ITEM — the route
        // depends on this (nextRenewalDate); verify against the real API
        expect(item.current_period_end).toBeTypeOf('number');

        const retrieved = await adapter.getPrice(price.id);
        expect(retrieved.unit_amount).toBe(700);

        const preview = await adapter.previewInvoice({
            customer: customer.id,
            subscription: created.id,
            item: { id: item.id, quantity: 3 },
            proration_behavior: 'always_invoice',
        });
        expect(preview.amount_due).toBeTypeOf('number');
        expect(preview.currency).toBe('usd');

        await adapter.updateSubscription(created.id, {
            items: [{ id: item.id, quantity: 3 }],
            proration_behavior: 'always_invoice',
        });
        const updated = await adapter.getSubscription(created.id);
        expect(updated.items!.data[0].quantity).toBe(3);
    });
});
