/**
 * Arrange/teardown for the billing specs (seat pre-purchase,
 * plans/seat-prepurchase-oneshot.md). Runs in Node, as the dedicated
 * BILLING_USER (see testUser.ts) so nothing here touches the main e2e
 * user's workspace.
 *
 * Talks to three things:
 *  - the Fastify server's app API (workspace-get-default, subscription-get,
 *    workspace-get, invite rescind / member remove) and its /stripe-webhooks
 *    endpoint — the webhook is signed here exactly like Stripe signs it, so
 *    the real handler runs without `stripe listen`;
 *  - Stripe's TEST-MODE API with the same secret key the server uses
 *    (server/.env.local): the subscriptions are real test-mode objects, so
 *    the server's real Stripe adapter works mid-test (seat changes hit
 *    Stripe);
 *  - Supabase PostgREST with the service-role key, only to delete the
 *    subscriptions row at teardown — no app route does that; same
 *    service-role pattern fixtures/project.ts uses for storage.
 */
import { createHmac } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parse as parseEnv } from 'dotenv';
import { API_URL, BILLING_USER, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL } from './testUser';
import { api, signIn } from './project';

const SERVER_ENV_PATH = path.join(import.meta.dirname, '../../server/.env.local');

export interface StripeEnv {
    secretKey: string;
    webhookSecret: string;
    priceIdMonthly: string;
}

/**
 * The server's Stripe test-mode config. null when it is missing — the
 * billing specs skip with a message instead of failing obscurely.
 */
export function loadStripeEnv(): StripeEnv | null {
    if (!existsSync(SERVER_ENV_PATH)) return null;
    const env = parseEnv(readFileSync(SERVER_ENV_PATH));
    const secretKey = env.STRIPE_SECRET_KEY;
    const webhookSecret = env.STRIPE_WEBHOOK_SECRET;
    const priceIdMonthly = env.STRIPE_PRICE_ID_MONTHLY;
    // Never run against a live key, whatever the env says
    if (!secretKey?.startsWith('sk_test_') || !webhookSecret || !priceIdMonthly) return null;
    return { secretKey, webhookSecret, priceIdMonthly };
}

// ── Stripe test-mode API ────────────────────────────────────────────────────

type StripeParams = Record<string, string | number>;

function formEncode(params: StripeParams): string {
    return Object.entries(params)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join('&');
}

/** Minimal Stripe REST call (form-encoded, bracket keys for nested params). */
export async function stripe<T = Record<string, unknown>>(
    env: StripeEnv,
    method: 'GET' | 'POST' | 'DELETE',
    route: string,
    params?: StripeParams,
): Promise<T> {
    const res = await fetch(`https://api.stripe.com/v1${route}`, {
        method,
        headers: {
            Authorization: `Bearer ${env.secretKey}`,
            ...(params ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
        },
        body: params ? formEncode(params) : undefined,
    });
    const json = (await res.json()) as T & { error?: { message?: string } };
    if (!res.ok) {
        throw new Error(`Stripe ${method} ${route} failed: ${res.status} ${json.error?.message ?? JSON.stringify(json)}`);
    }
    return json;
}

/**
 * Deliver an event to the server the way Stripe would: the same
 * `t=…,v1=HMAC-SHA256(secret, "t.payload")` signature the SDK verifies.
 * A concurrent `stripe listen` delivery of the real event is harmless —
 * the checkout handler is an upsert.
 */
export async function postSignedWebhook(env: StripeEnv, type: string, object: unknown): Promise<void> {
    const created = Math.floor(Date.now() / 1000);
    const payload = JSON.stringify({
        id: `evt_e2e_${created}_${Math.random().toString(36).slice(2, 8)}`,
        object: 'event',
        type,
        created,
        data: { object },
    });
    const signature = createHmac('sha256', env.webhookSecret).update(`${created}.${payload}`).digest('hex');
    const res = await fetch(`${API_URL}/stripe-webhooks`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'stripe-signature': `t=${created},v1=${signature}`,
        },
        body: payload,
    });
    if (!res.ok) throw new Error(`webhook ${type} rejected: ${res.status} ${await res.text()}`);
}

/** Poll a Checkout Session until the hosted page reports it complete. */
export async function waitForCheckoutComplete(
    env: StripeEnv,
    sessionId: string,
    timeoutMs = 60_000,
): Promise<Record<string, unknown>> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const session = await stripe(env, 'GET', `/checkout/sessions/${sessionId}`);
        if (session.status === 'complete') return session;
        if (Date.now() > deadline) throw new Error(`checkout session ${sessionId} never completed (status ${String(session.status)})`);
        await new Promise(r => setTimeout(r, 2000));
    }
}

// ── Workspace state ─────────────────────────────────────────────────────────

export interface E2eWorkspace {
    token: string;
    userId: string;
    workspaceId: string;
}

/** The workspace the app itself loads for the billing user (stored default → oldest owned). */
export async function currentWorkspace(): Promise<E2eWorkspace> {
    const { token, userId } = await signIn(BILLING_USER);
    const ws = await api('workspace-get-default', token, {});
    return { token, userId, workspaceId: ws.id as string };
}

/**
 * A real test-mode subscription for the workspace, delivered to the
 * server through the same checkout.session.completed webhook a real
 * checkout produces (so the row is written by production code).
 */
export async function seedProSubscription(
    env: StripeEnv,
    opts: { workspaceId: string; userId: string; email: string; seats: number },
): Promise<{ customerId: string; subscriptionId: string }> {
    const customer = await stripe<{ id: string }>(env, 'POST', '/customers', {
        email: opts.email,
        payment_method: 'pm_card_visa',
        'invoice_settings[default_payment_method]': 'pm_card_visa',
        'metadata[source]': 'recordio-e2e',
    });
    const sub = await stripe<{ id: string; status: string }>(env, 'POST', '/subscriptions', {
        customer: customer.id,
        'items[0][price]': env.priceIdMonthly,
        'items[0][quantity]': opts.seats,
        'metadata[source]': 'recordio-e2e',
    });
    if (sub.status !== 'active') throw new Error(`seeded subscription is ${sub.status}, expected active`);

    await postSignedWebhook(env, 'checkout.session.completed', {
        object: 'checkout.session',
        metadata: { userId: opts.userId, workspaceId: opts.workspaceId, interval: 'monthly' },
        client_reference_id: opts.userId,
        customer: customer.id,
        subscription: sub.id,
    });
    return { customerId: customer.id, subscriptionId: sub.id };
}

/**
 * Back to a free, solo workspace: delete the Stripe customer (cancels its
 * subscriptions), rescind pending invitations and remove non-owner
 * members through the app API, then delete the subscriptions row.
 */
export async function resetBilling(env: StripeEnv | null, workspaceId: string): Promise<void> {
    const { token } = await signIn(BILLING_USER);

    const { subscription } = await api('subscription-get', token, { workspaceId });
    const customerId = subscription?.stripe_customer_id as string | undefined;
    if (env && customerId) {
        await stripe(env, 'DELETE', `/customers/${customerId}`).catch(() => {});
    }

    const details = await api('workspace-get', token, { workspaceId });
    for (const inv of (details?.invitations ?? []) as Array<{ id: string }>) {
        await api('workspace-invite-rescind', token, { invitationId: inv.id }).catch(() => {});
    }
    for (const m of (details?.members ?? []) as Array<{ user_id: string }>) {
        if (m.user_id === details.owner_id) continue;
        await api('workspace-member-remove', token, { workspaceId, userId: m.user_id }).catch(() => {});
    }

    const res = await fetch(`${SUPABASE_URL}/rest/v1/subscriptions?workspace_id=eq.${workspaceId}`, {
        method: 'DELETE',
        headers: {
            apikey: SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            Prefer: 'return=minimal',
        },
    });
    if (!res.ok) throw new Error(`could not delete the subscription row: ${res.status} ${await res.text()}`);
}
