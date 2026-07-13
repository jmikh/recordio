import type {
    StripeCheckoutSessionParams,
    StripeInvoicePreview,
    StripeInvoicePreviewParams,
    StripePort,
    StripePrice,
    StripeSubscription,
    StripeWebhookEvent,
} from '../../src/ports/stripe.js';

/** The only signature the fake accepts — anything else throws like the SDK would. */
export const FAKE_STRIPE_SIGNATURE = 'fake-valid-stripe-signature';

export interface FakeStripe extends StripePort {
    /** Recorded calls, for assertions */
    checkoutSessions: StripeCheckoutSessionParams[];
    portalSessions: Array<{ customer: string; return_url: string }>;
    subscriptionUpdates: Array<{ id: string; params: unknown }>;
    invoicePreviews: StripeInvoicePreviewParams[];
    /** Canned data, seedable per test */
    subscriptions: Map<string, StripeSubscription>;
    prices: Map<string, StripePrice>;
    invoicePreview: StripeInvoicePreview;
}

export function createFakeStripe(): FakeStripe {
    const fake: FakeStripe = {
        checkoutSessions: [],
        portalSessions: [],
        subscriptionUpdates: [],
        invoicePreviews: [],
        subscriptions: new Map(),
        prices: new Map(),
        invoicePreview: { amount_due: 0, subtotal: 0, total: 0, currency: 'usd', lines: { data: [] } },

        async createCheckoutSession(params) {
            fake.checkoutSessions.push(params);
            return { url: `https://fake-stripe/checkout/cs_${fake.checkoutSessions.length}` };
        },
        async createPortalSession(params) {
            fake.portalSessions.push(params);
            return { url: `https://fake-stripe/portal/ps_${fake.portalSessions.length}` };
        },
        async getSubscription(id) {
            const sub = fake.subscriptions.get(id);
            if (!sub) throw new Error(`FakeStripe: no such subscription ${id}`);
            return sub;
        },
        async updateSubscription(id, params) {
            fake.subscriptionUpdates.push({ id, params });
        },
        async getPrice(id) {
            const price = fake.prices.get(id);
            if (!price) throw new Error(`FakeStripe: no such price ${id}`);
            return price;
        },
        async previewInvoice(params) {
            fake.invoicePreviews.push(params);
            return fake.invoicePreview;
        },
        async verifyWebhook(rawBody, signature) {
            if (signature !== FAKE_STRIPE_SIGNATURE) throw new Error('FakeStripe: invalid signature');
            return JSON.parse(rawBody) as StripeWebhookEvent;
        },
    };
    return fake;
}
