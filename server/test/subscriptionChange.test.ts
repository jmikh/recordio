/**
 * POST /subscription-change — e2e against the real local `supabase start`
 * Postgres (merge-blocking tier). First migrated route with a DB WRITE, so
 * the resulting-DB-state assertions cover both directions: dryRun leaves
 * the row untouched, apply updates plan/seats/billing_interval. Stripe is
 * the in-memory fake (canned subscription/prices/preview, recorded
 * updates); its real adapter has its own integration test.
 *
 * Isolation: unique workspace ids, targeted deletes in afterEach
 * (members/subscriptions cascade). Tokens are hand-signed with SEEDED user
 * ids (membership rows FK auth.users).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { buildApp, type App } from '../src/app.js';
import type { StripePriceIds } from '../src/routes/stripeCheckout.js';
import { createFakeDeps, type FakeDeps } from './fakes/index.js';
import { TEST_JWT_SECRET, userToken } from './helpers/tokens.js';
import {
    createTestPool,
    deleteWorkspaces,
    hasTestDb,
    SEEDED_USER_2_ID,
    SEEDED_USER_ID,
    seedSubscription,
    seedWorkspace,
    seedWorkspaceMember,
} from './helpers/db.js';

const PRICE_IDS: StripePriceIds = {
    pro_monthly: 'price_pro_m',
    pro_yearly: 'price_pro_y',
    teams_monthly: 'price_teams_m',
    teams_yearly: 'price_teams_y',
};

const SUB_ID = 'sub_change_test';
const CUS_ID = 'cus_change_test';
/** Fixed epoch seconds — nextRenewalDate must be its exact ISO string */
const PERIOD_END = 1800000000;

const adminToken = () => userToken({ sub: SEEDED_USER_ID });

function validBody(workspaceId: string, overrides: Record<string, unknown> = {}) {
    return { workspaceId, newPlan: 'teams', newSeats: 8, dryRun: true, ...overrides };
}

async function post(app: App, body: unknown, token?: string) {
    return app.inject({
        method: 'POST',
        url: '/subscription-change',
        headers: token ? { authorization: `Bearer ${token}` } : {},
        payload: body as Record<string, unknown>,
    });
}

/** Canned Stripe state: active teams-monthly subscription, 5 seats. */
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
                    price: { id: 'price_teams_m', unit_amount: 1000, recurring: { interval: 'month' } },
                },
            ],
        },
    });
    deps.stripe.prices.set('price_teams_m', {
        id: 'price_teams_m',
        unit_amount: 1000,
        recurring: { interval: 'month' },
    });
    deps.stripe.prices.set('price_teams_y', {
        id: 'price_teams_y',
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
        const res = await post(app, body, await adminToken());
        expect(res.statusCode).toBe(400);
    });

    it('400 for a non-teams plan (edge fn: "Only upgrades to Teams are supported")', async () => {
        const { app } = validationApp();
        const res = await post(app, validBody('ws-1', { newPlan: 'pro' }), await adminToken());
        expect(res.statusCode).toBe(400);
    });

    it('400 when newSeats is below 1 or not an integer', async () => {
        const { app } = validationApp();
        expect((await post(app, validBody('ws-1', { newSeats: 0 }), await adminToken())).statusCode).toBe(400);
        expect((await post(app, validBody('ws-1', { newSeats: 2.5 }), await adminToken())).statusCode).toBe(400);
    });

    it('400 for an invalid newInterval', async () => {
        const { app } = validationApp();
        const res = await post(app, validBody('ws-1', { newInterval: 'weekly' }), await adminToken());
        expect(res.statusCode).toBe(400);
    });

    it('400 when dryRun is missing — never defaults into the apply branch (divergence: edge fn applied)', async () => {
        const { app, deps } = validationApp();
        const body: Record<string, unknown> = validBody('ws-1');
        delete body.dryRun;
        const res = await post(app, body, await adminToken());
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

    /** Workspace with SEEDED_USER_ID as admin + an active teams subscription linked to the fake Stripe state. */
    async function seedTeamsWorkspace(
        subOverrides: Partial<Parameters<typeof seedSubscription>[1]> = {},
    ) {
        const ws = await seedWs();
        await seedWorkspaceMember(pool, { workspaceId: ws.id, userId: SEEDED_USER_ID });
        await seedSubscription(pool, {
            workspaceId: ws.id,
            plan: 'teams',
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
            'SELECT plan, seats, billing_interval, updated_at FROM subscriptions WHERE workspace_id = $1',
            [workspaceId],
        );
        return rows[0] as { plan: string; seats: number | null; billing_interval: string; updated_at: Date };
    }

    it('403 with the exact edge-fn body for a non-member, no Stripe calls', async () => {
        const { app, deps } = testApp();
        const ws = await seedWs({ ownerId: SEEDED_USER_2_ID });
        await seedWorkspaceMember(pool, { workspaceId: ws.id, userId: SEEDED_USER_2_ID });
        await seedSubscription(pool, { workspaceId: ws.id, userId: SEEDED_USER_2_ID, plan: 'teams', seats: 5 });

        const res = await post(app, validBody(ws.id), await adminToken());
        expect(res.statusCode).toBe(403);
        expect(res.json()).toEqual({ error: 'Unauthorized or subscription not found' });
        expect(deps.stripe.invoicePreviews).toHaveLength(0);
        expect(deps.stripe.subscriptionUpdates).toHaveLength(0);
    });

    it('403 for a non-admin member (creator role) — assert_workspace_admin parity', async () => {
        const { app } = testApp();
        const ws = await seedWs({ ownerId: SEEDED_USER_2_ID });
        await seedWorkspaceMember(pool, { workspaceId: ws.id, userId: SEEDED_USER_2_ID });
        await seedWorkspaceMember(pool, { workspaceId: ws.id, userId: SEEDED_USER_ID, role: 'creator' });
        await seedSubscription(pool, { workspaceId: ws.id, userId: SEEDED_USER_2_ID, plan: 'teams', seats: 5 });

        const res = await post(app, validBody(ws.id), await adminToken());
        expect(res.statusCode).toBe(403);
        expect(res.json()).toEqual({ error: 'Unauthorized or subscription not found' });
    });

    it('403 when the workspace is soft-deleted, even for its admin', async () => {
        const { app } = testApp();
        const ws = await seedWs({ deletedAt: new Date().toISOString() });
        await seedWorkspaceMember(pool, { workspaceId: ws.id, userId: SEEDED_USER_ID });
        await seedSubscription(pool, { workspaceId: ws.id, plan: 'teams', seats: 5 });

        const res = await post(app, validBody(ws.id), await adminToken());
        expect(res.statusCode).toBe(403);
    });

    it('404 for an admin whose workspace has no subscription row (RPC NULL parity)', async () => {
        const { app } = testApp();
        const ws = await seedWs();
        await seedWorkspaceMember(pool, { workspaceId: ws.id, userId: SEEDED_USER_ID });

        const res = await post(app, validBody(ws.id), await adminToken());
        expect(res.statusCode).toBe(404);
        expect(res.json()).toEqual({ error: 'No subscription found for this workspace' });
    });

    it('400 when the subscription is not active/trialing', async () => {
        const { app } = testApp();
        const ws = await seedTeamsWorkspace({ status: 'canceled' });

        const res = await post(app, validBody(ws.id), await adminToken());
        expect(res.statusCode).toBe(400);
        expect(res.json()).toEqual({ error: 'Subscription is not active' });
    });

    it('400 for a yearly → monthly interval downgrade', async () => {
        const { app } = testApp();
        const ws = await seedTeamsWorkspace({ billingInterval: 'yearly' });

        const res = await post(app, validBody(ws.id, { newInterval: 'monthly' }), await adminToken());
        expect(res.statusCode).toBe(400);
        expect(res.json()).toEqual({ error: 'Downgrade from yearly to monthly billing is not supported' });
    });

    it('400 no-op guard: same plan, seats and interval', async () => {
        const { app } = testApp();
        const ws = await seedTeamsWorkspace();

        const res = await post(app, validBody(ws.id, { newSeats: 5 }), await adminToken());
        expect(res.statusCode).toBe(400);
        expect(res.json()).toEqual({ error: 'No change in plan, seats, or billing interval' });
    });

    it('404 when the subscription row has no Stripe subscription id', async () => {
        const { app } = testApp();
        const ws = await seedTeamsWorkspace({ stripeSubscriptionId: null });

        const res = await post(app, validBody(ws.id), await adminToken());
        expect(res.statusCode).toBe(404);
        expect(res.json()).toEqual({ error: 'No Stripe subscription linked to this workspace' });
    });

    it('400 seat floor: exact interpolated body, no Stripe calls', async () => {
        const { app, deps } = testApp();
        const ws = await seedTeamsWorkspace();
        await seedWorkspaceMember(pool, { workspaceId: ws.id, userId: SEEDED_USER_2_ID, role: 'creator' });

        const res = await post(app, validBody(ws.id, { newSeats: 1 }), await adminToken());
        expect(res.statusCode).toBe(400);
        expect(res.json()).toEqual({ error: 'Cannot set fewer seats than current member count (2)' });
        expect(deps.stripe.invoicePreviews).toHaveLength(0);
        expect(deps.stripe.subscriptionUpdates).toHaveLength(0);
    });

    it('500 with the exact edge-fn body when the Stripe subscription has no items', async () => {
        const { app, deps } = testApp();
        deps.stripe.subscriptions.set(SUB_ID, {
            id: SUB_ID,
            status: 'active',
            customer: CUS_ID,
            items: { data: [] },
        });
        const ws = await seedTeamsWorkspace();

        const res = await post(app, validBody(ws.id), await adminToken());
        expect(res.statusCode).toBe(500);
        expect(res.json()).toEqual({ error: 'No subscription item found on Stripe subscription' });
    });

    it('dryRun seats-only: 200 preview with parity math, DB unchanged, no update call', async () => {
        const { app, deps } = testApp();
        const ws = await seedTeamsWorkspace();
        const before = await getSubRow(ws.id);

        const res = await post(app, validBody(ws.id, { newSeats: 8, dryRun: true }), await adminToken());
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({
            immediateCharge: 30, // amount_due 3000 / 100
            nextRenewalAmount: 80, // price_teams_m 1000 * 8 seats / 100
            billingInterval: 'monthly',
            nextRenewalDate: new Date(PERIOD_END * 1000).toISOString(),
            currency: 'usd',
        });
        // No price in the preview item — same plan and interval
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

    it('dryRun interval change: preview item carries the target price; billingInterval stays CURRENT (edge-fn smell, kept)', async () => {
        const { app, deps } = testApp();
        const ws = await seedTeamsWorkspace();

        const res = await post(
            app,
            validBody(ws.id, { newSeats: 5, newInterval: 'yearly', dryRun: true }),
            await adminToken(),
        );
        expect(res.statusCode).toBe(200);
        expect(res.json()).toMatchObject({
            nextRenewalAmount: 500, // price_teams_y 10000 * 5 seats / 100
            billingInterval: 'monthly', // parity: current, not target
        });
        expect(deps.stripe.invoicePreviews[0]).toMatchObject({
            item: { id: 'si_1', quantity: 5, price: 'price_teams_y' },
        });
    });

    it('apply seats-only: 200, update recorded without price, DB row written', async () => {
        const { app, deps } = testApp();
        const ws = await seedTeamsWorkspace();
        const before = await getSubRow(ws.id);

        const res = await post(app, validBody(ws.id, { newSeats: 8, dryRun: false }), await adminToken());
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ success: true, plan: 'teams', seats: 8, billingInterval: 'monthly' });
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
        expect(after).toMatchObject({ plan: 'teams', seats: 8, billing_interval: 'monthly' });
        expect(after.updated_at.getTime()).toBeGreaterThanOrEqual(before.updated_at.getTime());
    });

    it('apply pro → teams upgrade (trialing): update carries the price, DB plan/seats written', async () => {
        const { app, deps } = testApp();
        const ws = await seedTeamsWorkspace({
            plan: 'pro',
            seats: null, // constraint: seats only on teams
            status: 'trialing',
        });

        const res = await post(app, validBody(ws.id, { newSeats: 3, dryRun: false }), await adminToken());
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ success: true, plan: 'teams', seats: 3, billingInterval: 'monthly' });
        expect(deps.stripe.subscriptionUpdates[0]).toEqual({
            id: SUB_ID,
            params: {
                items: [{ id: 'si_1', quantity: 3, price: 'price_teams_m' }],
                proration_behavior: 'always_invoice',
            },
        });
        expect(await getSubRow(ws.id)).toMatchObject({
            plan: 'teams',
            seats: 3,
            billing_interval: 'monthly',
        });
    });

    it('contributes workspace/plan/interval/dry_run to the canonical request event', async () => {
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
        const ws = await seedTeamsWorkspace();

        const res = await post(app, validBody(ws.id, { newSeats: 8, dryRun: true }), await adminToken());
        expect(res.statusCode).toBe(200);
        expect(lines.find((l) => l.msg === 'request')).toMatchObject({
            'http.route': '/subscription-change',
            'http.response.status_code': 200,
            'workspace.id': ws.id,
            'stripe.plan': 'teams',
            'stripe.interval': 'monthly',
            'stripe.dry_run': true,
            user_id: SEEDED_USER_ID,
        });
    });
});
