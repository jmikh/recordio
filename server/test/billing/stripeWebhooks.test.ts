/**
 * POST /stripe-webhooks — e2e against the real local Postgres;
 * fakeStripe drives signature verification (`FAKE_STRIPE_SIGNATURE`;
 * its verify parses the raw body as the event) and cans the
 * authoritative subscription the checkout handler retrieves.
 *
 * Pins the two 2026-07-22 divergence decisions: signature failures are
 * 400 (both cases), and the webhook NEVER touches projects — every
 * mutating handler asserts seeded projects.expires_at values survive
 * verbatim (the edge fn's set_project_expiry calls are NOT ported).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { buildApp, type App } from '../../src/app.js';
import { createFakeDeps, FAKE_STRIPE_SIGNATURE, type FakeDeps } from '../fakes/index.js';
import { TEST_JWT_SECRET } from '../helpers/tokens.js';
import type { StripeSubscription } from '../../src/ports/stripe.js';
import {
    createTestPool,
    deleteProjects,
    deleteWorkspaces,
    hasTestDb,
    SEEDED_USER_ID,
    seedProject,
    seedSubscription,
    seedWorkspace,
} from '../helpers/db.js';

const TEST_SUPABASE_URL = 'http://127.0.0.1:54321';

/** 2024-07-23T02:40:00Z — a fixed "event happened" unix timestamp. */
const EVENT_CREATED = 1_721_702_400;
const EVENT_CREATED_ISO = new Date(EVENT_CREATED * 1000).toISOString();

function build(deps: FakeDeps) {
    return buildApp(deps, {
        supabaseJwtSecret: TEST_JWT_SECRET,
        supabaseUrl: TEST_SUPABASE_URL,
        logLevel: 'silent',
    });
}

/** Body goes as a RAW string — the route verifies the exact bytes. */
async function post(app: App, body: string, headers: Record<string, string> = {}) {
    return app.inject({
        method: 'POST',
        url: '/stripe-webhooks',
        headers: { 'content-type': 'application/json', ...headers },
        payload: body,
    });
}

const signed = { 'stripe-signature': FAKE_STRIPE_SIGNATURE };

function makeEvent(type: string, object: unknown, created = EVENT_CREATED) {
    return JSON.stringify({ id: `evt_${randomUUID()}`, type, created, data: { object } });
}

interface SubPayloadOptions {
    status?: string;
    interval?: 'month' | 'year';
    quantity?: number;
    /** Unix seconds on the ITEM (dahlia placement); undefined → absent */
    periodEnd?: number;
    /** Unix seconds; clover payloads carry scheduled cancellations here */
    cancelAt?: number;
}

/**
 * Subscription object as it appears in webhook payloads / the port
 * shape. Price metadata is empty — the single-plan handlers never read
 * plan_type (billing revamp Step 1).
 */
function subPayload(customerId: string, opts: SubPayloadOptions = {}): StripeSubscription {
    return {
        id: `sub_${randomUUID().slice(0, 8)}`,
        status: opts.status ?? 'active',
        customer: customerId,
        cancel_at: opts.cancelAt ?? null,
        items: {
            data: [
                {
                    id: 'si_1',
                    quantity: opts.quantity,
                    current_period_end: opts.periodEnd,
                    price: {
                        id: 'price_test',
                        unit_amount: 1500,
                        metadata: {},
                        recurring: { interval: opts.interval ?? 'month' },
                    },
                },
            ],
        },
    };
}

function checkoutSession(opts: {
    userId?: string | null;
    workspaceId?: string | null;
    customer?: string;
    subscription?: string | null;
}) {
    return {
        metadata: {
            ...(opts.userId ? { userId: opts.userId } : {}),
            ...(opts.workspaceId ? { workspaceId: opts.workspaceId } : {}),
        },
        client_reference_id: null,
        customer: opts.customer ?? `cus_${randomUUID().slice(0, 8)}`,
        subscription: opts.subscription === undefined ? `sub_${randomUUID().slice(0, 8)}` : opts.subscription,
    };
}

describe('POST /stripe-webhooks (auth + dispatch, no db)', () => {
    // Throwing-db deps prove these paths exit before any query
    it('400 with the exact body when the stripe-signature header is missing', async () => {
        const app = build(createFakeDeps());
        const res = await post(app, makeEvent('customer.subscription.updated', {}));
        expect(res.statusCode).toBe(400);
        expect(res.json()).toEqual({ error: 'No signature' });
    });

    it('400 on a bad signature (the edge fn 500\'d this through its boundary — decision 2026-07-22)', async () => {
        const app = build(createFakeDeps());
        const res = await post(app, makeEvent('customer.subscription.updated', {}), {
            'stripe-signature': 't=1,v1=wrong',
        });
        expect(res.statusCode).toBe(400);
        expect(res.json()).toEqual({ error: 'Invalid signature' });
    });

    it('the EXACT raw string reaches the verifier (no reserialization)', async () => {
        const deps = createFakeDeps();
        const captured: Array<{ rawBody: string; signature: string }> = [];
        deps.stripe.verifyWebhook = async (rawBody, signature) => {
            captured.push({ rawBody, signature });
            throw new Error('invalid');
        };
        const app = build(deps);
        // Non-canonical spacing/key order — any parse+stringify would change it
        const rawBody = '{ "type" : "customer.subscription.updated",\n  "created": 1, "data": { "object": {} } }';

        const res = await post(app, rawBody, { 'stripe-signature': 'whatever' });

        expect(res.statusCode).toBe(400);
        expect(captured).toEqual([{ rawBody, signature: 'whatever' }]);
    });

    it('unhandled event type → 200 { received: true }, zero queries', async () => {
        const app = build(createFakeDeps());
        const res = await post(app, makeEvent('invoice.paid', { id: 'in_1' }), signed);
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ received: true });
    });

    it.each([
        ['userId', checkoutSession({ workspaceId: 'ws-1' })],
        ['workspaceId', checkoutSession({ userId: 'u-1' })],
        ['subscriptionId', checkoutSession({ userId: 'u-1', workspaceId: 'ws-1', subscription: null })],
    ])('checkout.session.completed missing %s → 500 (Stripe retries), pre-query', async (_name, session) => {
        const app = build(createFakeDeps());
        const res = await post(app, makeEvent('checkout.session.completed', session), signed);
        expect(res.statusCode).toBe(500);
    });

});

describe.runIf(hasTestDb())('POST /stripe-webhooks (e2e, real Postgres)', () => {
    let pool: pg.Pool;
    const createdWorkspaces: string[] = [];
    const createdProjects: string[] = [];

    beforeAll(() => {
        pool = createTestPool();
    });
    afterEach(async () => {
        await deleteWorkspaces(pool, createdWorkspaces);
        await deleteProjects(pool, createdProjects);
        createdWorkspaces.length = 0;
        createdProjects.length = 0;
    });
    afterAll(async () => {
        await pool.end();
    });

    function testApp(): { app: App; deps: FakeDeps } {
        const deps = createFakeDeps({ db: pool });
        return { app: build(deps), deps };
    }

    async function seedWs() {
        const ws = await seedWorkspace(pool, {});
        createdWorkspaces.push(ws.id);
        return ws;
    }

    /**
     * The decision-2b pin: one project with a live countdown, one without.
     * The edge fn's set_project_expiry would have rewritten one of them on
     * every transition; the server must touch neither.
     */
    async function seedExpiryPinProjects() {
        const dated = await seedProject(pool, { expiresAt: '2026-08-01T00:00:00.000Z' });
        const undated = await seedProject(pool, { expiresAt: null });
        createdProjects.push(dated.id, undated.id);
        return { dated: dated.id, undated: undated.id };
    }

    async function expectProjectsUntouched(pin: { dated: string; undated: string }) {
        const { rows } = await pool.query(
            'SELECT id, expires_at FROM projects WHERE id = ANY($1::uuid[]) ORDER BY id',
            [[pin.dated, pin.undated].sort()],
        );
        const byId = new Map((rows as { id: string; expires_at: Date | null }[]).map((r) => [r.id, r.expires_at]));
        expect(byId.get(pin.dated)?.toISOString()).toBe('2026-08-01T00:00:00.000Z');
        expect(byId.get(pin.undated)).toBeNull();
    }

    interface SubRow {
        user_id: string;
        stripe_customer_id: string | null;
        stripe_subscription_id: string | null;
        status: string;
        plan: string;
        billing_interval: string | null;
        current_period_end: Date | null;
        cancel_at: Date | null;
        seats: number | null;
        stripe_event_at: Date | null;
    }

    async function subRows(workspaceId: string): Promise<SubRow[]> {
        const { rows } = await pool.query('SELECT * FROM subscriptions WHERE workspace_id = $1', [
            workspaceId,
        ]);
        return rows as SubRow[];
    }

    it('checkout.session.completed: upserts the full row from the retrieved subscription; projects untouched', async () => {
        const { app, deps } = testApp();
        const ws = await seedWs();
        const pin = await seedExpiryPinProjects();
        const customer = `cus_${randomUUID().slice(0, 8)}`;
        const session = checkoutSession({ userId: SEEDED_USER_ID, workspaceId: ws.id, customer });
        // periodEnd on the ITEM (dahlia placement) — 2026-09-01T00:00:00Z
        deps.stripe.subscriptions.set(
            session.subscription!,
            subPayload(customer, {
                status: 'trialing',
                interval: 'year',
                quantity: 5,
                periodEnd: 1_787_875_200,
            }),
        );

        const res = await post(app, makeEvent('checkout.session.completed', session), signed);

        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ received: true });
        const rows = await subRows(ws.id);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            user_id: SEEDED_USER_ID,
            stripe_customer_id: customer,
            stripe_subscription_id: session.subscription,
            status: 'trialing',
            billing_interval: 'yearly',
            cancel_at: null,
            seats: 5,
            stripe_event_at: null, // parity: checkout does NOT stamp it
        });
        expect(rows[0].current_period_end?.toISOString()).toBe(
            new Date(1_787_875_200 * 1000).toISOString(),
        );
        // The edge fn would have CLEARED the dated project's expiry here
        await expectProjectsUntouched(pin);
    });

    it('checkout.session.completed over an existing row: updated in place (ON CONFLICT workspace_id)', async () => {
        const { app, deps } = testApp();
        const ws = await seedWs();
        await seedSubscription(pool, {
            workspaceId: ws.id,
            status: 'canceled',
            billingInterval: 'monthly',
        });
        const customer = `cus_${randomUUID().slice(0, 8)}`;
        const session = checkoutSession({ userId: SEEDED_USER_ID, workspaceId: ws.id, customer });
        deps.stripe.subscriptions.set(
            session.subscription!,
            subPayload(customer, { status: 'active', interval: 'month' }),
        );

        const res = await post(app, makeEvent('checkout.session.completed', session), signed);

        expect(res.statusCode).toBe(200);
        const rows = await subRows(ws.id);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            status: 'active',
            stripe_customer_id: customer,
            billing_interval: 'monthly',
        });
    });

    it('subscription.updated: row updated, stripe_event_at stamped; projects untouched on deactivation', async () => {
        const { app } = testApp();
        const ws = await seedWs();
        const pin = await seedExpiryPinProjects();
        const customer = `cus_${randomUUID().slice(0, 8)}`;
        await seedSubscription(pool, {
            workspaceId: ws.id,
            seats: 5,
            status: 'active',
            stripeCustomerId: customer,
            stripeEventAt: null,
        });

        const res = await post(
            app,
            makeEvent(
                'customer.subscription.updated',
                subPayload(customer, {
                    status: 'canceled',
                    quantity: 7,
                    periodEnd: 1_787_875_200,
                    cancelAt: 1_787_875_200,
                }),
            ),
            signed,
        );

        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ received: true });
        const [row] = await subRows(ws.id);
        expect(row).toMatchObject({
            status: 'canceled',
            seats: 7,
            cancel_at: new Date(1_787_875_200 * 1000),
        });
        expect(row.stripe_event_at?.toISOString()).toBe(EVENT_CREATED_ISO);
        // The edge fn would have stamped +14 d on the undated project here
        await expectProjectsUntouched(pin);
    });

    it('OUT-OF-ORDER PIN: an event at or before stripe_event_at is discarded, row unchanged', async () => {
        const { app } = testApp();
        const ws = await seedWs();
        const customer = `cus_${randomUUID().slice(0, 8)}`;
        await seedSubscription(pool, {
            workspaceId: ws.id,
            status: 'active',
            stripeCustomerId: customer,
            stripeEventAt: EVENT_CREATED_ISO,
        });

        const res = await post(
            app,
            makeEvent(
                'customer.subscription.updated',
                subPayload(customer, { status: 'past_due', periodEnd: 1_787_875_200 }),
                EVENT_CREATED, // equal → discarded (edge fn used <=)
            ),
            signed,
        );

        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ received: true });
        const [row] = await subRows(ws.id);
        expect(row.status).toBe('active');
        expect(row.stripe_event_at?.toISOString()).toBe(EVENT_CREATED_ISO);
    });

    it('DRIFT DETECTOR (revamp Step 6): quantity ≠ computed member count logs a warn; sync still applies', async () => {
        const lines: Record<string, unknown>[] = [];
        const deps = createFakeDeps({ db: pool });
        const app = buildApp(deps, {
            supabaseJwtSecret: TEST_JWT_SECRET,
            supabaseUrl: TEST_SUPABASE_URL,
            logStream: {
                write(chunk: string) {
                    for (const line of chunk.split('\n')) {
                        if (line.trim()) lines.push(JSON.parse(line));
                    }
                },
            },
        });
        const ws = await seedWs(); // solo owner → computed billed seats = 1
        const customer = `cus_${randomUUID().slice(0, 8)}`;
        await seedSubscription(pool, {
            workspaceId: ws.id, status: 'active', stripeCustomerId: customer, stripeEventAt: null,
        });

        const res = await post(
            app,
            makeEvent('customer.subscription.updated',
                subPayload(customer, { quantity: 7, periodEnd: 1_787_875_200 })),
            signed,
        );
        expect(res.statusCode).toBe(200);

        // Sync applied as delivered (Stripe is authoritative for the row)…
        const [row] = await subRows(ws.id);
        expect(row.seats).toBe(7);
        // …and the mismatch versus the computed count is warned (log-only —
        // the next seat event self-heals)
        const warn = lines.find((l) => l.msg === 'seat quantity drift between Stripe and member count');
        expect(warn).toMatchObject({ stripe_quantity: 7, computed_seats: 1 });
    });

    it('subscription.updated for an unknown customer → 500 (Stripe retries; covers the checkout race)', async () => {
        const { app } = testApp();
        const res = await post(
            app,
            makeEvent(
                'customer.subscription.updated',
                subPayload(`cus_${randomUUID()}`, { periodEnd: 1_787_875_200 }),
            ),
            signed,
        );
        expect(res.statusCode).toBe(500);
    });

    it('subscription.updated without any current_period_end → 500, row unchanged', async () => {
        const { app } = testApp();
        const ws = await seedWs();
        const customer = `cus_${randomUUID().slice(0, 8)}`;
        await seedSubscription(pool, {
            workspaceId: ws.id,
            status: 'active',
            stripeCustomerId: customer,
        });

        const res = await post(
            app,
            makeEvent('customer.subscription.updated', subPayload(customer, { status: 'past_due' })),
            signed,
        );

        expect(res.statusCode).toBe(500);
        const [row] = await subRows(ws.id);
        expect(row.status).toBe('active');
        expect(row.stripe_event_at).toBeNull();
    });

    it('subscription.deleted: canceled / seats reset to 1, stripe_event_at stamped; projects untouched', async () => {
        const { app } = testApp();
        const ws = await seedWs();
        const pin = await seedExpiryPinProjects();
        const customer = `cus_${randomUUID().slice(0, 8)}`;
        await seedSubscription(pool, {
            workspaceId: ws.id,
            seats: 5,
            status: 'active',
            stripeCustomerId: customer,
        });

        const res = await post(
            app,
            makeEvent('customer.subscription.deleted', subPayload(customer)),
            signed,
        );

        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ received: true });
        const [row] = await subRows(ws.id);
        expect(row).toMatchObject({ status: 'canceled', seats: 1 });
        expect(row.stripe_event_at?.toISOString()).toBe(EVENT_CREATED_ISO);
        // The edge fn would have stamped +14 d on the undated project here
        await expectProjectsUntouched(pin);
    });

    it('PARITY PIN: deleted has NO ordering guard — a stale redelivered deleted still cancels', async () => {
        const { app } = testApp();
        const ws = await seedWs();
        const customer = `cus_${randomUUID().slice(0, 8)}`;
        // Stored event_at is NEWER than the incoming deleted event
        await seedSubscription(pool, {
            workspaceId: ws.id,
            status: 'active',
            stripeCustomerId: customer,
            stripeEventAt: new Date((EVENT_CREATED + 3600) * 1000).toISOString(),
        });

        const res = await post(
            app,
            makeEvent('customer.subscription.deleted', subPayload(customer), EVENT_CREATED),
            signed,
        );

        expect(res.statusCode).toBe(200);
        const [row] = await subRows(ws.id);
        expect(row.status).toBe('canceled');
        expect(row.stripe_event_at?.toISOString()).toBe(EVENT_CREATED_ISO);
    });

    it('subscription.deleted for an unknown customer: 200 no-op (parity)', async () => {
        const { app } = testApp();
        const res = await post(
            app,
            makeEvent('customer.subscription.deleted', subPayload(`cus_${randomUUID()}`)),
            signed,
        );
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ received: true });
    });

    it('the raw-body parser is SCOPED: other routes still get parsed JSON', async () => {
        const { app } = testApp();
        const project = await seedProject(pool, {});
        createdProjects.push(project.id);

        const res = await app.inject({
            method: 'POST',
            url: '/shared-video-get',
            payload: { slug: project.slug },
        });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toMatchObject({ name: project.name });
    });

    it('contributes stripe.event_type / workspace.id and emits subscription.changed', async () => {
        const lines: Record<string, unknown>[] = [];
        const deps = createFakeDeps({ db: pool });
        const app = buildApp(deps, {
            supabaseJwtSecret: TEST_JWT_SECRET,
            supabaseUrl: TEST_SUPABASE_URL,
            logStream: {
                write(chunk: string) {
                    for (const line of chunk.split('\n')) {
                        if (line.trim()) lines.push(JSON.parse(line));
                    }
                },
            },
        });
        const ws = await seedWs();
        const customer = `cus_${randomUUID().slice(0, 8)}`;
        await seedSubscription(pool, { workspaceId: ws.id, status: 'active', stripeCustomerId: customer });

        const res = await post(
            app,
            makeEvent(
                'customer.subscription.updated',
                subPayload(customer, { status: 'past_due', periodEnd: 1_787_875_200 }),
            ),
            signed,
        );
        expect(res.statusCode).toBe(200);

        expect(lines.find((l) => l.msg === 'request')).toMatchObject({
            'http.route': '/stripe-webhooks',
            'http.response.status_code': 200,
            'stripe.event_type': 'customer.subscription.updated',
            'workspace.id': ws.id,
        });
        expect(lines.find((l) => l.event === 'subscription.changed')).toMatchObject({
            'workspace.id': ws.id,
            'stripe.event_type': 'customer.subscription.updated',
        });
    });
});
