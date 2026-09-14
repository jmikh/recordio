/**
 * POST /subscription-change — e2e against the real local `supabase start`
 * Postgres (merge-blocking tier). First migrated route with a DB WRITE, so
 * the resulting-DB-state assertions cover both directions: dryRun leaves
 * the row untouched, apply updates seats/billing_interval. Stripe is
 * the in-memory fake (canned subscription/prices/preview, recorded
 * updates); its real adapter has its own integration test.
 *
 * Seat pre-purchase (plans/seat-prepurchase-oneshot.md): `newSeats` is
 * the purchased count to move to, floored at the seats in use or
 * reserved by pending creator/admin invitations; omitted = keep the
 * current count (interval-only change). Proration is always_invoice in
 * both directions (a decrease previews as a negative immediate charge —
 * the balance credit).
 *
 * Isolation: unique workspace ids, targeted deletes in afterEach
 * (members/subscriptions cascade). Tokens are hand-signed with SEEDED user
 * ids (membership rows FK auth.users).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { buildApp, type App } from '../../src/app.js';
import type { StripePriceIds } from '../../src/routes/billing/stripeCheckout.js';
import { createFakeDeps, type FakeDeps } from '../fakes/index.js';
import { TEST_JWT_SECRET, userToken } from '../helpers/tokens.js';
import {
    createTestPool,
    deleteWorkspaces,
    hasTestDb,
    SEEDED_USER_2_ID,
    SEEDED_USER_ID,
    seedSubscription,
    seedWorkspace,
    seedWorkspaceInvitation,
    seedWorkspaceMember,
} from '../helpers/db.js';

const PRICE_IDS: StripePriceIds = {
    monthly: 'price_m',
    yearly: 'price_y',
};

const SUB_ID = 'sub_change_test';
const CUS_ID = 'cus_change_test';
/** Fixed epoch seconds — nextRenewalDate must be its exact ISO string */
const PERIOD_END = 1800000000;

const ownerToken = () => userToken({ sub: SEEDED_USER_ID });

function validBody(workspaceId: string, overrides: Record<string, unknown> = {}) {
    return { workspaceId, newSeats: 8, dryRun: true, ...overrides };
}

async function post(app: App, body: unknown, token?: string) {
    return app.inject({
        method: 'POST',
        url: '/subscription-change',
        headers: token ? { authorization: `Bearer ${token}` } : {},
        payload: body as Record<string, unknown>,
    });
}

/** Canned Stripe state: active monthly subscription, 5 seats. */
function seedFakeStripe(deps: FakeDeps) {
    deps.stripe.subscriptions.set(SUB_ID, {
        id: SUB_ID,
        status: 'active',
        customer: CUS_ID,
        items: {
            data: [
                {
                    id: 'si_1',
                    quantity: 5,
                    current_period_end: PERIOD_END,
                    price: { id: 'price_m', unit_amount: 1000, recurring: { interval: 'month' } },
                },
            ],
        },
    });
    deps.stripe.prices.set('price_m', {
        id: 'price_m',
        unit_amount: 1000,
        recurring: { interval: 'month' },
    });
    deps.stripe.prices.set('price_y', {
        id: 'price_y',
        unit_amount: 10000,
        recurring: { interval: 'year' },
    });
    deps.stripe.invoicePreview = {
        amount_due: 3000,
        subtotal: 3000,
        total: 3000,
        currency: 'usd',
        lines: { data: [] },
    };
}

describe('POST /subscription-change (auth + validation, no db)', () => {
    // Throwing-db deps prove 401/400 reject before any query
    function validationApp(): { app: App; deps: FakeDeps } {
        const deps = createFakeDeps();
        const app = buildApp(deps, {
            supabaseJwtSecret: TEST_JWT_SECRET,
            stripePriceIds: PRICE_IDS,
            logLevel: 'silent',
        });
        return { app, deps };
    }

    it('401 without a token, same body shape as the edge function', async () => {
        const { app, deps } = validationApp();
        const res = await post(app, validBody('ws-1'));
        expect(res.statusCode).toBe(401);
        expect(res.json()).toEqual({ error: 'Unauthorized' });
        expect(deps.stripe.subscriptionUpdates).toHaveLength(0);
    });

    it('400 when workspaceId is missing (edge fn also 400)', async () => {
        const { app } = validationApp();
        const body: Record<string, unknown> = validBody('ws-1');
        delete body.workspaceId;
        const res = await post(app, body, await ownerToken());
        expect(res.statusCode).toBe(400);
    });

    it('400 when newSeats is below 1 or not an integer', async () => {
        const { app } = validationApp();
        expect((await post(app, validBody('ws-1', { newSeats: 0 }), await ownerToken())).statusCode).toBe(400);
        expect((await post(app, validBody('ws-1', { newSeats: 2.5 }), await ownerToken())).statusCode).toBe(400);
    });

    it('400 for an invalid newInterval', async () => {
        const { app } = validationApp();
        const res = await post(app, validBody('ws-1', { newInterval: 'weekly' }), await ownerToken());
        expect(res.statusCode).toBe(400);
    });

    it('400 when dryRun is missing — never defaults into the apply branch (divergence: edge fn applied)', async () => {
        const { app, deps } = validationApp();
        const body: Record<string, unknown> = validBody('ws-1');
        delete body.dryRun;
        const res = await post(app, body, await ownerToken());
        expect(res.statusCode).toBe(400);
        expect(deps.stripe.subscriptionUpdates).toHaveLength(0);
    });
});

describe.runIf(hasTestDb())('POST /subscription-change (e2e, real Postgres)', () => {
    // Lazy: describe bodies run at collection time even when runIf skips
    let pool: pg.Pool;
    const createdWorkspaces: string[] = [];

    beforeAll(() => {
        pool = createTestPool();
    });

    afterEach(async () => {
        await deleteWorkspaces(pool, createdWorkspaces);
        createdWorkspaces.length = 0;
    });
    afterAll(async () => {
        await pool.end();
    });

    function testApp(): { app: App; deps: FakeDeps } {
        const deps = createFakeDeps({ db: pool });
        seedFakeStripe(deps);
        const app = buildApp(deps, {
            supabaseJwtSecret: TEST_JWT_SECRET,
            stripePriceIds: PRICE_IDS,
            logLevel: 'silent',
        });
        return { app, deps: deps as FakeDeps };
    }

    async function seedWs(opts: Parameters<typeof seedWorkspace>[1] = {}) {
        const ws = await seedWorkspace(pool, opts);
        createdWorkspaces.push(ws.id);
        return ws;
    }

    /** Workspace owned by SEEDED_USER_ID (owner = implicit admin, no member row) + an active subscription linked to the fake Stripe state. */
    async function seedSubscribedWorkspace(
        subOverrides: Partial<Parameters<typeof seedSubscription>[1]> = {},
    ) {
        const ws = await seedWs();
        await seedSubscription(pool, {
            workspaceId: ws.id,
            seats: 5,
            billingInterval: 'monthly',
            stripeCustomerId: CUS_ID,
            stripeSubscriptionId: SUB_ID,
            ...subOverrides,
        });
        return ws;
    }

    async function getSubRow(workspaceId: string) {
        const { rows } = await pool.query(
            'SELECT seats, billing_interval, updated_at FROM subscriptions WHERE workspace_id = $1',
            [workspaceId],
        );
        return rows[0] as { seats: number; billing_interval: string; updated_at: Date };
    }

    it('403 with the exact edge-fn body for a non-member, no Stripe calls', async () => {
        const { app, deps } = testApp();
        const ws = await seedWs({ ownerId: SEEDED_USER_2_ID });
        await seedWorkspaceMember(pool, { workspaceId: ws.id, userId: SEEDED_USER_2_ID });
        await seedSubscription(pool, { workspaceId: ws.id, userId: SEEDED_USER_2_ID, seats: 5 });

        const res = await post(app, validBody(ws.id), await ownerToken());
        expect(res.statusCode).toBe(403);
        expect(res.json()).toEqual({ error: 'Unauthorized or subscription not found' });
        expect(deps.stripe.invoicePreviews).toHaveLength(0);
        expect(deps.stripe.subscriptionUpdates).toHaveLength(0);
    });

    it.each(['creator', 'admin'] as const)(
        '403 for a non-owner member (%s) — seat changes are owner-only',
        async (role) => {
            const { app } = testApp();
            const ws = await seedWs({ ownerId: SEEDED_USER_2_ID });
            await seedWorkspaceMember(pool, { workspaceId: ws.id, userId: SEEDED_USER_2_ID });
            await seedWorkspaceMember(pool, { workspaceId: ws.id, userId: SEEDED_USER_ID, role });
            await seedSubscription(pool, { workspaceId: ws.id, userId: SEEDED_USER_2_ID, seats: 5 });

            const res = await post(app, validBody(ws.id), await ownerToken());
            expect(res.statusCode).toBe(403);
            expect(res.json()).toEqual({ error: 'Unauthorized or subscription not found' });
        },
    );

    it('403 when the workspace is soft-deleted, even for its owner', async () => {
        const { app } = testApp();
        const ws = await seedWs({ deletedAt: new Date().toISOString() });
        await seedWorkspaceMember(pool, { workspaceId: ws.id, userId: SEEDED_USER_ID });
        await seedSubscription(pool, { workspaceId: ws.id, seats: 5 });

        const res = await post(app, validBody(ws.id), await ownerToken());
        expect(res.statusCode).toBe(403);
    });

    it('404 for an admin whose workspace has no subscription row (RPC NULL parity)', async () => {
        const { app } = testApp();
        const ws = await seedWs();
        await seedWorkspaceMember(pool, { workspaceId: ws.id, userId: SEEDED_USER_ID });

        const res = await post(app, validBody(ws.id), await ownerToken());
        expect(res.statusCode).toBe(404);
        expect(res.json()).toEqual({ error: 'No subscription found for this workspace' });
    });

    it('400 when the subscription is not active/trialing', async () => {
        const { app } = testApp();
        const ws = await seedSubscribedWorkspace({ status: 'canceled' });

        const res = await post(app, validBody(ws.id), await ownerToken());
        expect(res.statusCode).toBe(400);
        expect(res.json()).toEqual({ error: 'Subscription is not active' });
    });

    it('400 for a yearly → monthly interval downgrade', async () => {
        const { app } = testApp();
        const ws = await seedSubscribedWorkspace({ billingInterval: 'yearly' });

        const res = await post(app, validBody(ws.id, { newInterval: 'monthly' }), await ownerToken());
        expect(res.statusCode).toBe(400);
        expect(res.json()).toEqual({ error: 'Downgrade from yearly to monthly billing is not supported' });
    });

    it('400 no-op guard: same seats and interval (explicit and omitted newSeats alike)', async () => {
        const { app } = testApp();
        const ws = await seedSubscribedWorkspace();

        const explicit = await post(app, validBody(ws.id, { newSeats: 5 }), await ownerToken());
        expect(explicit.statusCode).toBe(400);
        expect(explicit.json()).toEqual({ error: 'No change in seats or billing interval' });

        const omitted = await post(app, { workspaceId: ws.id, dryRun: true }, await ownerToken());
        expect(omitted.statusCode).toBe(400);
        expect(omitted.json()).toEqual({ error: 'No change in seats or billing interval' });
    });

    it('400 seat floor: members holding seats + pending creator/admin invitations; a stale owner row never inflates it', async () => {
        const { app, deps } = testApp();
        const ws = await seedSubscribedWorkspace();
        await seedWorkspaceMember(pool, { workspaceId: ws.id, userId: SEEDED_USER_2_ID, role: 'creator' });
        await seedWorkspaceInvitation(pool, { workspaceId: ws.id, email: 'reserved@example.com', role: 'admin' });
        await seedWorkspaceInvitation(pool, { workspaceId: ws.id, email: 'viewer@example.com', role: 'viewer' });
        // Pre-Step-2 data: an owner member row must not count as a second seat
        await seedWorkspaceMember(pool, { workspaceId: ws.id, userId: SEEDED_USER_ID, role: 'admin' });

        // floor = owner + creator member + pending admin invite = 3
        const below = await post(app, validBody(ws.id, { newSeats: 2 }), await ownerToken());
        expect(below.statusCode).toBe(400);
        expect(below.json()).toEqual({
            error: 'Cannot reduce below 3 seats — 3 are in use or reserved by pending invitations',
        });
        expect(deps.stripe.invoicePreviews).toHaveLength(0);

        const atFloor = await post(app, validBody(ws.id, { newSeats: 3 }), await ownerToken());
        expect(atFloor.statusCode).toBe(200);
        expect(deps.stripe.invoicePreviews[0]).toMatchObject({ item: { id: 'si_1', quantity: 3 } });
    });

    it('404 when the subscription row has no Stripe subscription id', async () => {
        const { app } = testApp();
        const ws = await seedSubscribedWorkspace({ stripeSubscriptionId: null });

        const res = await post(app, validBody(ws.id, { newInterval: 'yearly' }), await ownerToken());
        expect(res.statusCode).toBe(404);
        expect(res.json()).toEqual({ error: 'No Stripe subscription linked to this workspace' });
    });

    it('500 with the exact edge-fn body when the Stripe subscription has no items', async () => {
        const { app, deps } = testApp();
        deps.stripe.subscriptions.set(SUB_ID, {
            id: SUB_ID,
            status: 'active',
            customer: CUS_ID,
            items: { data: [] },
        });
        const ws = await seedSubscribedWorkspace();

        const res = await post(app, validBody(ws.id, { newInterval: 'yearly' }), await ownerToken());
        expect(res.statusCode).toBe(500);
        expect(res.json()).toEqual({ error: 'No subscription item found on Stripe subscription' });
    });

    it('dryRun seat increase: preview at newSeats, renewal = price × newSeats, row untouched', async () => {
        const { app, deps } = testApp();
        const ws = await seedSubscribedWorkspace();
        const before = await getSubRow(ws.id);

        const res = await post(app, validBody(ws.id, { newSeats: 8 }), await ownerToken());
        expect(res.statusCode).toBe(200);
        expect(res.json()).toMatchObject({
            immediateCharge: 30, // amount_due 3000 / 100
            nextRenewalAmount: 80, // price_m 1000 * 8 seats / 100
            billingInterval: 'monthly',
            nextRenewalDate: new Date(PERIOD_END * 1000).toISOString(),
            currency: 'usd',
        });
        expect(deps.stripe.invoicePreviews).toEqual([
            {
                customer: CUS_ID,
                subscription: SUB_ID,
                item: { id: 'si_1', quantity: 8 },
                proration_behavior: 'always_invoice',
            },
        ]);
        expect(deps.stripe.subscriptionUpdates).toHaveLength(0);
        expect(await getSubRow(ws.id)).toEqual(before);
    });

    it('dryRun seat decrease previews the balance credit as a negative immediate charge', async () => {
        const { app, deps } = testApp();
        deps.stripe.invoicePreview = { amount_due: -1500, subtotal: -1500, total: -1500, currency: 'usd', lines: { data: [] } };
        const ws = await seedSubscribedWorkspace();

        const res = await post(app, validBody(ws.id, { newSeats: 3 }), await ownerToken());
        expect(res.statusCode).toBe(200);
        expect(res.json()).toMatchObject({ immediateCharge: -15, nextRenewalAmount: 30 });
        expect(deps.stripe.invoicePreviews[0]).toMatchObject({
            item: { id: 'si_1', quantity: 3 },
            proration_behavior: 'always_invoice',
        });
    });

    it('dryRun interval change with newSeats omitted carries the CURRENT seats; billingInterval stays current (edge-fn smell, kept)', async () => {
        const { app, deps } = testApp();
        const ws = await seedSubscribedWorkspace();

        const res = await post(app, { workspaceId: ws.id, newInterval: 'yearly', dryRun: true }, await ownerToken());
        expect(res.statusCode).toBe(200);
        expect(res.json()).toMatchObject({
            nextRenewalAmount: 500, // price_y 10000 * 5 current seats / 100
            billingInterval: 'monthly', // parity: current, not target
        });
        expect(deps.stripe.invoicePreviews).toEqual([
            {
                customer: CUS_ID,
                subscription: SUB_ID,
                item: { id: 'si_1', quantity: 5, price: 'price_y' },
                proration_behavior: 'always_invoice',
            },
        ]);
    });

    it('apply seat increase: Stripe quantity set, DB seats written, interval unchanged', async () => {
        const { app, deps } = testApp();
        const ws = await seedSubscribedWorkspace();
        const before = await getSubRow(ws.id);

        const res = await post(app, validBody(ws.id, { newSeats: 8, dryRun: false }), await ownerToken());
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ success: true, seats: 8, billingInterval: 'monthly' });
        expect(deps.stripe.subscriptionUpdates).toEqual([
            {
                id: SUB_ID,
                params: {
                    items: [{ id: 'si_1', quantity: 8 }],
                    proration_behavior: 'always_invoice',
                },
            },
        ]);
        expect(deps.stripe.invoicePreviews).toHaveLength(0);

        // First migrated route with a DB write — assert the resulting state
        const after = await getSubRow(ws.id);
        expect(after).toMatchObject({ seats: 8, billing_interval: 'monthly' });
        expect(after.updated_at.getTime()).toBeGreaterThanOrEqual(before.updated_at.getTime());
    });

    it('apply seats + interval upgrade together: update carries both, DB row written', async () => {
        const { app, deps } = testApp();
        const ws = await seedSubscribedWorkspace();

        const res = await post(
            app,
            validBody(ws.id, { newSeats: 2, newInterval: 'yearly', dryRun: false }),
            await ownerToken(),
        );
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ success: true, seats: 2, billingInterval: 'yearly' });
        expect(deps.stripe.subscriptionUpdates[0]).toEqual({
            id: SUB_ID,
            params: {
                items: [{ id: 'si_1', quantity: 2, price: 'price_y' }],
                proration_behavior: 'always_invoice',
            },
        });
        expect(await getSubRow(ws.id)).toMatchObject({ seats: 2, billing_interval: 'yearly' });
    });

    it('apply interval upgrade (trialing) with newSeats omitted keeps the current seats', async () => {
        const { app, deps } = testApp();
        const ws = await seedSubscribedWorkspace({ status: 'trialing' });

        const res = await post(
            app,
            { workspaceId: ws.id, newInterval: 'yearly', dryRun: false },
            await ownerToken(),
        );
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ success: true, seats: 5, billingInterval: 'yearly' });
        expect(deps.stripe.subscriptionUpdates[0]).toEqual({
            id: SUB_ID,
            params: {
                items: [{ id: 'si_1', quantity: 5, price: 'price_y' }],
                proration_behavior: 'always_invoice',
            },
        });
        expect(await getSubRow(ws.id)).toMatchObject({
            seats: 5,
            billing_interval: 'yearly',
        });
    });

    it('contributes workspace/interval/dry_run to the canonical request event', async () => {
        const lines: Record<string, unknown>[] = [];
        const deps = createFakeDeps({ db: pool });
        seedFakeStripe(deps);
        const app = buildApp(deps, {
            supabaseJwtSecret: TEST_JWT_SECRET,
            stripePriceIds: PRICE_IDS,
            logStream: {
                write(chunk: string) {
                    for (const line of chunk.split('\n')) {
                        if (line.trim()) lines.push(JSON.parse(line));
                    }
                },
            },
        });
        const ws = await seedSubscribedWorkspace();

        const res = await post(app, validBody(ws.id, { newInterval: 'yearly', dryRun: true }), await ownerToken());
        expect(res.statusCode).toBe(200);
        expect(lines.find((l) => l.msg === 'request')).toMatchObject({
            'http.route': '/subscription-change',
            'http.response.status_code': 200,
            'workspace.id': ws.id,
            'stripe.interval': 'yearly',
            'stripe.dry_run': true,
            user_id: SEEDED_USER_ID,
        });
    });
});
