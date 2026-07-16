/**
 * Unit tests for POST /stripe-checkout — full HTTP stack via app.inject()
 * with fake deps. No DB involved: the route is auth + price lookup + one
 * Stripe call, so (like storage-download-urls) this IS its e2e tier.
 */
import { describe, expect, it } from 'vitest';
import { buildApp, type App } from '../src/app.js';
import type { StripePriceIds } from '../src/routes/stripeCheckout.js';
import { createFakeDeps, type FakeDeps } from './fakes/index.js';
import { TEST_JWT_SECRET, userToken } from './helpers/tokens.js';

const PRICE_IDS: StripePriceIds = {
    pro_monthly: 'price_pro_m',
    pro_yearly: 'price_pro_y',
    teams_monthly: 'price_teams_m',
    teams_yearly: 'price_teams_y',
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

function testApp(): { app: App; deps: FakeDeps } {
    const deps = createFakeDeps();
    const app = buildApp(deps, {
        supabaseJwtSecret: TEST_JWT_SECRET,
        stripePriceIds: PRICE_IDS,
        logLevel: 'silent',
    });
    return { app, deps };
}

async function post(app: App, body: unknown, token?: string) {
    return app.inject({
        method: 'POST',
        url: '/stripe-checkout',
        headers: token ? { authorization: `Bearer ${token}` } : {},
        payload: body as Record<string, unknown>,
    });
}

describe('POST /stripe-checkout', () => {
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

    it('400 for an unknown plan (edge fn: 400 "no price configured")', async () => {
        const { app } = testApp();
        const res = await post(app, { ...validBody, plan: 'enterprise' }, await userToken());
        expect(res.statusCode).toBe(400);
    });

    it('403 with the exact edge-function body when userId does not match the token', async () => {
        const { app, deps } = testApp();
        const res = await post(app, { ...validBody, userId: 'user-2' }, await userToken());
        expect(res.statusCode).toBe(403);
        expect(res.json()).toEqual({ error: 'Unauthorized: User ID mismatch' });
        expect(deps.stripe.checkoutSessions).toHaveLength(0);
    });

    it('defaults to pro yearly, quantity 1 — full session params parity', async () => {
        const { app, deps } = testApp();
        const res = await post(app, validBody, await userToken());

        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ url: 'https://fake-stripe/checkout/cs_1' });
        expect(deps.stripe.checkoutSessions).toEqual([
            {
                customer_email: 'user@example.com',
                client_reference_id: USER_ID,
                price: 'price_pro_y',
                quantity: 1,
                success_url: 'https://app.example.com/billing',
                cancel_url: 'https://app.example.com/billing',
                metadata: {
                    userId: USER_ID,
                    workspaceId: 'ws-1',
                    plan: 'pro',
                    interval: 'yearly',
                    seats: '1',
                },
            },
        ]);
    });

    it('pro monthly resolves the pro_monthly price; seats ignored for pro', async () => {
        const { app, deps } = testApp();
        const res = await post(
            app,
            { ...validBody, plan: 'pro', interval: 'monthly', seats: 9 },
            await userToken(),
        );
        expect(res.statusCode).toBe(200);
        expect(deps.stripe.checkoutSessions[0]).toMatchObject({
            price: 'price_pro_m',
            quantity: 1,
            metadata: expect.objectContaining({ plan: 'pro', interval: 'monthly', seats: '1' }),
        });
    });

    it('teams uses seats as quantity and the teams price', async () => {
        const { app, deps } = testApp();
        const res = await post(
            app,
            { ...validBody, plan: 'teams', interval: 'monthly', seats: 7 },
            await userToken(),
        );
        expect(res.statusCode).toBe(200);
        expect(deps.stripe.checkoutSessions[0]).toMatchObject({
            price: 'price_teams_m',
            quantity: 7,
            metadata: expect.objectContaining({ plan: 'teams', seats: '7' }),
        });
    });

    it('teams seats default to 5 and clamp below at 1 (edge fn Math.max parity)', async () => {
        const { app, deps } = testApp();

        await post(app, { ...validBody, plan: 'teams' }, await userToken());
        expect(deps.stripe.checkoutSessions[0]).toMatchObject({ quantity: 5 });

        await post(app, { ...validBody, plan: 'teams', seats: 0 }, await userToken());
        expect(deps.stripe.checkoutSessions[1]).toMatchObject({
            quantity: 1,
            metadata: expect.objectContaining({ seats: '1' }),
        });
    });

    it('500 when the app is built without price ids (fail loudly, no bad session)', async () => {
        const deps = createFakeDeps();
        const app = buildApp(deps, { supabaseJwtSecret: TEST_JWT_SECRET, logLevel: 'silent' });
        const res = await post(app, validBody, await userToken());
        expect(res.statusCode).toBe(500);
        expect(deps.stripe.checkoutSessions).toHaveLength(0);
    });

    it('contributes workspace/plan/interval to the canonical request event', async () => {
        const lines: Record<string, unknown>[] = [];
        const deps = createFakeDeps();
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
        await post(app, { ...validBody, plan: 'teams', interval: 'monthly' }, await userToken());

        const event = lines.find((l) => l.msg === 'request');
        expect(event).toMatchObject({
            'http.route': '/stripe-checkout',
            'http.response.status_code': 200,
            'workspace.id': 'ws-1',
            'stripe.plan': 'teams',
            'stripe.interval': 'monthly',
            user_id: USER_ID,
        });
    });
});
