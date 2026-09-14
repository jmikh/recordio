/**
 * POST /stripe-checkout — full HTTP stack via app.inject() with fake
 * deps. The route reads the DB: caller must be the OWNER of the
 * workspace, and the quantity is the CHOSEN seat count (seat
 * pre-purchase, plans/seat-prepurchase-oneshot.md) floored at the seats
 * already in use (owner + creator/admin members) — so the happy path
 * lives in the real-Postgres e2e tier; the validation tier covers
 * everything that fails before the first query.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
    seedWorkspace,
    seedWorkspaceMember,
} from '../helpers/db.js';

const PRICE_IDS: StripePriceIds = {
    monthly: 'price_m',
    yearly: 'price_y',
};

/** Matches the fake token's sub (helpers/tokens.ts). */
const USER_ID = 'user-1';

const validBody = {
    userId: USER_ID,
    userEmail: 'user@example.com',
    workspaceId: 'ws-1',
    successUrl: 'https://app.example.com/billing',
    cancelUrl: 'https://app.example.com/billing',
};

async function post(app: App, body: unknown, token?: string) {
    return app.inject({
        method: 'POST',
        url: '/stripe-checkout',
        headers: token ? { authorization: `Bearer ${token}` } : {},
        payload: body as Record<string, unknown>,
    });
}

describe('POST /stripe-checkout (auth + validation, no db)', () => {
    function testApp(): { app: App; deps: FakeDeps } {
        const deps = createFakeDeps();
        const app = buildApp(deps, {
            supabaseJwtSecret: TEST_JWT_SECRET,
            stripePriceIds: PRICE_IDS,
            logLevel: 'silent',
        });
        return { app, deps };
    }

    it('401 without a token, same body shape as the edge function', async () => {
        const { app, deps } = testApp();
        const res = await post(app, validBody);
        expect(res.statusCode).toBe(401);
        expect(res.json()).toEqual({ error: 'Unauthorized' });
        expect(deps.stripe.checkoutSessions).toHaveLength(0);
    });

    it('400 when workspaceId is missing (edge fn also 400)', async () => {
        const { app } = testApp();
        const body: Record<string, unknown> = { ...validBody };
        delete body.workspaceId;
        const res = await post(app, body, await userToken());
        expect(res.statusCode).toBe(400);
    });

    it('400 when successUrl is missing', async () => {
        const { app } = testApp();
        const body: Record<string, unknown> = { ...validBody };
        delete body.successUrl;
        const res = await post(app, body, await userToken());
        expect(res.statusCode).toBe(400);
    });

    it('400 for an invalid interval', async () => {
        const { app } = testApp();
        const res = await post(app, { ...validBody, interval: 'weekly' }, await userToken());
        expect(res.statusCode).toBe(400);
    });

    it('400 when seats is below 1 or not an integer', async () => {
        const { app } = testApp();
        expect((await post(app, { ...validBody, seats: 0 }, await userToken())).statusCode).toBe(400);
        expect((await post(app, { ...validBody, seats: 1.5 }, await userToken())).statusCode).toBe(400);
    });

    it('403 with the exact edge-function body when userId does not match the token', async () => {
        const { app, deps } = testApp();
        const res = await post(app, { ...validBody, userId: 'user-2' }, await userToken());
        expect(res.statusCode).toBe(403);
        expect(res.json()).toEqual({ error: 'Unauthorized: User ID mismatch' });
        expect(deps.stripe.checkoutSessions).toHaveLength(0);
    });

    it('500 when the app is built without price ids (fail loudly, no bad session)', async () => {
        const deps = createFakeDeps();
        const app = buildApp(deps, { supabaseJwtSecret: TEST_JWT_SECRET, logLevel: 'silent' });
        const res = await post(app, validBody, await userToken());
        expect(res.statusCode).toBe(500);
        expect(deps.stripe.checkoutSessions).toHaveLength(0);
    });
});

describe.runIf(hasTestDb())('POST /stripe-checkout (e2e, real Postgres)', () => {
    let pool: pg.Pool;
    const createdWorkspaces: string[] = [];

    beforeAll(() => {
        pool = createTestPool();
    });
    afterAll(async () => {
        await deleteWorkspaces(pool, createdWorkspaces);
        await pool.end();
    });

    function testApp(): { app: App; deps: FakeDeps } {
        const deps = createFakeDeps({ db: pool }) as FakeDeps;
        const app = buildApp(deps, {
            supabaseJwtSecret: TEST_JWT_SECRET,
            stripePriceIds: PRICE_IDS,
            logLevel: 'silent',
        });
        return { app, deps };
    }

    async function ownedWorkspace() {
        const ws = await seedWorkspace(pool); // owner: SEEDED_USER_ID
        createdWorkspaces.push(ws.id);
        return ws;
    }

    function bodyFor(workspaceId: string, userId = SEEDED_USER_ID) {
        return { ...validBody, userId, workspaceId };
    }

    it('owner: 200, defaults to yearly and to the seats in use — full session params (solo owner = 1)', async () => {
        const ws = await ownedWorkspace();
        const { app, deps } = testApp();
        const res = await post(app, bodyFor(ws.id), await userToken({ sub: SEEDED_USER_ID }));

        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ url: 'https://fake-stripe/checkout/cs_1' });
        expect(deps.stripe.checkoutSessions).toEqual([
            {
                customer_email: 'user@example.com',
                client_reference_id: SEEDED_USER_ID,
                price: 'price_y',
                quantity: 1,
                success_url: 'https://app.example.com/billing',
                cancel_url: 'https://app.example.com/billing',
                metadata: {
                    userId: SEEDED_USER_ID,
                    workspaceId: ws.id,
                    interval: 'yearly',
                },
            },
        ]);
    });

    it('seats chosen at checkout become the quantity', async () => {
        const ws = await ownedWorkspace();
        const { app, deps } = testApp();

        const res = await post(app, { ...bodyFor(ws.id), interval: 'monthly', seats: 3 },
            await userToken({ sub: SEEDED_USER_ID }));
        expect(res.statusCode).toBe(200);
        expect(deps.stripe.checkoutSessions[0]).toMatchObject({
            price: 'price_m',
            quantity: 3,
            metadata: expect.objectContaining({ interval: 'monthly' }),
        });
    });

    it('default quantity is the seats in use: creator member = 2, viewers free (post-lapse re-upgrade path)', async () => {
        const ws = await ownedWorkspace();
        await seedWorkspaceMember(pool, { workspaceId: ws.id, userId: SEEDED_USER_2_ID, role: 'creator' });
        const { app, deps } = testApp();

        const res = await post(app, bodyFor(ws.id), await userToken({ sub: SEEDED_USER_ID }));
        expect(res.statusCode).toBe(200);
        expect(deps.stripe.checkoutSessions[0]).toMatchObject({ quantity: 2 });
    });

    it('400 when the chosen seats do not cover the current members; no session', async () => {
        const ws = await ownedWorkspace();
        await seedWorkspaceMember(pool, { workspaceId: ws.id, userId: SEEDED_USER_2_ID, role: 'admin' });
        const { app, deps } = testApp();

        const res = await post(app, { ...bodyFor(ws.id), seats: 1 },
            await userToken({ sub: SEEDED_USER_ID }));
        expect(res.statusCode).toBe(400);
        expect(res.json()).toEqual({ error: 'Checkout needs at least 2 seats for the current members' });
        expect(deps.stripe.checkoutSessions).toHaveLength(0);
    });

    it('403 for a creator member and for a non-member (billing is owner-only)', async () => {
        const ws = await ownedWorkspace();
        await seedWorkspaceMember(pool, { workspaceId: ws.id, userId: SEEDED_USER_2_ID, role: 'creator' });
        const { app, deps } = testApp();

        const asCreator = await post(app, bodyFor(ws.id, SEEDED_USER_2_ID),
            await userToken({ sub: SEEDED_USER_2_ID }));
        expect(asCreator.statusCode).toBe(403);
        expect(asCreator.json()).toEqual({ error: 'Requires workspace ownership' });

        const stranger = await seedWorkspace(pool, { ownerId: SEEDED_USER_2_ID });
        createdWorkspaces.push(stranger.id);
        const asNonMember = await post(app, bodyFor(stranger.id),
            await userToken({ sub: SEEDED_USER_ID }));
        expect(asNonMember.statusCode).toBe(403);

        expect(deps.stripe.checkoutSessions).toHaveLength(0);
    });

    it('403 for an invited ADMIN member — buying the plan is the owner\u2019s alone', async () => {
        const ws = await seedWorkspace(pool, { ownerId: SEEDED_USER_2_ID });
        createdWorkspaces.push(ws.id);
        await seedWorkspaceMember(pool, { workspaceId: ws.id, userId: SEEDED_USER_ID, role: 'admin' });
        const { app, deps } = testApp();

        const res = await post(app, bodyFor(ws.id), await userToken({ sub: SEEDED_USER_ID }));
        expect(res.statusCode).toBe(403);
        expect(res.json()).toEqual({ error: 'Requires workspace ownership' });
        expect(deps.stripe.checkoutSessions).toHaveLength(0);
    });

    it('contributes workspace/interval to the canonical request event', async () => {
        const ws = await ownedWorkspace();
        const lines: Record<string, unknown>[] = [];
        const deps = createFakeDeps({ db: pool });
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
        await post(app, { ...bodyFor(ws.id), interval: 'monthly' },
            await userToken({ sub: SEEDED_USER_ID }));

        const event = lines.find((l) => l.msg === 'request');
        expect(event).toMatchObject({
            'http.route': '/stripe-checkout',
            'http.response.status_code': 200,
            'workspace.id': ws.id,
            'stripe.interval': 'monthly',
            user_id: SEEDED_USER_ID,
        });
    });
});
