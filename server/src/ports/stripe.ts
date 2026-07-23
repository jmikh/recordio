/**
 * Stripe port — sized to what the edge functions actually call:
 * checkout/portal session creation, subscription retrieve/update, price
 * lookup, invoice preview (subscription-change), and webhook verification.
 *
 * Field names deliberately keep Stripe's raw snake_case so the real adapter
 * is pure passthrough (no field mapping to drift) and webhook payloads can
 * be typed with the same shapes.
 */

export interface StripePrice {
    id: string;
    unit_amount: number | null;
    /** plan_type ('pro' | 'teams') lives here */
    metadata?: Record<string, string>;
    recurring?: { interval: string } | null;
}

export interface StripeSubscriptionItem {
    id: string;
    quantity?: number;
    current_period_end?: number;
    /** Object in webhook payloads and default retrieves; id string when unexpanded */
    price?: string | StripePrice;
}

export interface StripeSubscription {
    id: string;
    status: string;
    customer: string;
    current_period_end?: number;
    /** Unix seconds; scheduled cancellation (portal "cancel at period end" sets this on 2025+ API versions). Null/absent = renews */
    cancel_at?: number | null;
    items?: { data: StripeSubscriptionItem[] };
}

export interface StripeCheckoutSessionParams {
    customer_email: string;
    client_reference_id: string;
    price: string;
    quantity: number;
    success_url: string;
    cancel_url: string;
    metadata: Record<string, string>;
}

export interface StripeInvoicePreviewParams {
    customer: string;
    subscription: string;
    item: { id?: string; quantity: number; price?: string };
    proration_behavior: string;
}

export interface StripeInvoicePreview {
    amount_due: number;
    subtotal: number;
    total: number;
    currency: string;
    lines?: { data: Array<Record<string, unknown>> };
}

export interface StripeWebhookEvent {
    id: string;
    type: string;
    created: number;
    /** Raw Stripe payload — handlers cast per event type (e.g. StripeSubscription) */
    data: { object: unknown };
}

/** checkout.session.completed payload — the fields the webhook reads. */
export interface StripeCheckoutSession {
    metadata?: Record<string, string> | null;
    client_reference_id?: string | null;
    /** Id string in webhook payloads (objects only when expanded) */
    customer?: string | null;
    subscription?: string | null;
}

export interface StripePort {
    /** checkout.sessions.create (mode: 'subscription') */
    createCheckoutSession(params: StripeCheckoutSessionParams): Promise<{ url: string | null }>;
    /** billingPortal.sessions.create */
    createPortalSession(params: { customer: string; return_url: string }): Promise<{ url: string }>;
    getSubscription(id: string, opts?: { expandItemPrices?: boolean }): Promise<StripeSubscription>;
    updateSubscription(
        id: string,
        params: {
            items: Array<{ id: string; quantity?: number; price?: string }>;
            proration_behavior?: string;
        },
    ): Promise<void>;
    getPrice(id: string): Promise<StripePrice>;
    /** POST /v1/invoices/create_preview (not in the SDK version the edge fn used) */
    previewInvoice(params: StripeInvoicePreviewParams): Promise<StripeInvoicePreview>;
    /** webhooks.constructEvent on the raw body — throws on invalid signature */
    verifyWebhook(rawBody: string, signature: string): Promise<StripeWebhookEvent>;
}
