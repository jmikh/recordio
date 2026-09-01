/**
 * POST /stripe-portal — e2e against the real local `supabase start`
 * Postgres (merge-blocking tier): the route's whole risk is the inline
 * membership+subscription query that replaces the subscription_get RPC.
 * Stripe is the in-memory fake (its real adapter has its own integration
 * test).
 *
 * Isolation: unique workspace ids, targeted deletes in afterEach
 * (workspace_members and subscriptions cascade with the workspace) — see
 * test/helpers/db.ts for why truncation is not used.
 *
 * Tokens are hand-signed with a SEEDED user id: the membership rows need a
 * real auth.users FK target.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { buildApp, type App } from '../../src/app.js';
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
    seedWorkspaceMember,
} from '../helpers/db.js';

const memberToken = () => userToken({ sub: SEEDED_USER_ID });

function validBody(workspaceId: string) {
    return { returnUrl: 'https://app.example.com/billing', workspaceId };
}

async function post(app: App, body: unknown, token?: string) {
    return app.inject({
        method: 'POST',
        url: '/stripe-portal',
        headers: token ? { authorization: `Bearer ${token}` } : {},
        payload: body as Record<string, unknown>,
    });
}

describe('POST /stripe-portal (auth + validation, no db)', () => {
    // Throwing-db deps prove 401/400 reject before any query
    function validationApp(): { app: App; deps: FakeDeps } {
        const deps = createFakeDeps();
        const app = buildApp(deps, { supabaseJwtSecret: TEST_JWT_SECRET, logLevel: 'silent' });
        return { app, deps };
    }

    it('401 without a token, same body shape as the edge function', async () => {
        const { app, deps } = validationApp();
        const res = await post(app, validBody('ws-1'));
        expect(res.statusCode).toBe(401);
        expect(res.json()).toEqual({ error: 'Unauthorized' });
        expect(deps.stripe.portalSessions).toHaveLength(0);
    });

    it('401 for a garbage token', async () => {
        const { app } = validationApp();
        const res = await post(app, validBody('ws-1'), 'not-a-jwt');
        expect(res.statusCode).toBe(401);
    });

    it('400 when workspaceId is missing (edge fn also 400)', async () => {
        const { app, deps } = validationApp();
        const res = await post(app, { returnUrl: 'https://app.example.com/billing' }, await memberToken());
        expect(res.statusCode).toBe(400);
        expect(deps.stripe.portalSessions).toHaveLength(0);
    });

    it('400 when returnUrl is missing', async () => {
        const { app } = validationApp();
        const res = await post(app, { workspaceId: 'ws-1' }, await memberToken());
        expect(res.statusCode).toBe(400);
    });
});

describe.runIf(hasTestDb())('POST /stripe-portal (e2e, real Postgres)', () => {
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
        const app = buildApp(deps, { supabaseJwtSecret: TEST_JWT_SECRET, logLevel: 'silent' });
        return { app, deps: deps as FakeDeps };
    }

    async function seedWs(opts: Parameters<typeof seedWorkspace>[1] = {}) {
        const ws = await seedWorkspace(pool, opts);
        createdWorkspaces.push(ws.id);
        return ws;
    }

    it('member with a subscription: 200 + portal session params recorded', async () => {
        const { app, deps } = testApp();
        const ws = await seedWs(); // owner (implicit member): SEEDED_USER_ID
        await seedSubscription(pool, { workspaceId: ws.id, stripeCustomerId: 'cus_portal_test' });

        const res = await post(app, validBody(ws.id), await memberToken());
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ url: 'https://fake-stripe/portal/ps_1' });
        expect(deps.stripe.portalSessions).toEqual([
            { customer: 'cus_portal_test', return_url: 'https://app.example.com/billing' },
        ]);
    });

    it('non-admin membership roles also pass the membership check (RPC parity: any member)', async () => {
        const { app } = testApp();
        const ws = await seedWs({ ownerId: SEEDED_USER_2_ID });
        await seedWorkspaceMember(pool, { workspaceId: ws.id, userId: SEEDED_USER_ID, role: 'viewer' });
        await seedSubscription(pool, { workspaceId: ws.id, userId: SEEDED_USER_2_ID });

        const res = await post(app, validBody(ws.id), await memberToken());
        expect(res.statusCode).toBe(200);
    });

    it('non-member: 404 with the exact edge-function body, no Stripe call', async () => {
        const { app, deps } = testApp();
        // Workspace + subscription exist, but the caller is not a member
        const ws = await seedWs({ ownerId: SEEDED_USER_2_ID });
        await seedSubscription(pool, { workspaceId: ws.id, userId: SEEDED_USER_2_ID });

        const res = await post(app, validBody(ws.id), await memberToken());
        expect(res.statusCode).toBe(404);
        expect(res.json()).toEqual({ error: 'No subscription found for this workspace' });
        expect(deps.stripe.portalSessions).toHaveLength(0);
    });

    it('member but no subscription row: 404, same body (RPC returned NULL for both)', async () => {
        const { app, deps } = testApp();
        const ws = await seedWs(); // owner (implicit member): SEEDED_USER_ID

        const res = await post(app, validBody(ws.id), await memberToken());
        expect(res.statusCode).toBe(404);
        expect(res.json()).toEqual({ error: 'No subscription found for this workspace' });
        expect(deps.stripe.portalSessions).toHaveLength(0);
    });

    it('subscription with a NULL stripe_customer_id: 404 (edge fn !sub?.stripe_customer_id parity)', async () => {
        const { app, deps } = testApp();
        const ws = await seedWs(); // owner (implicit member): SEEDED_USER_ID
        await seedSubscription(pool, { workspaceId: ws.id, stripeCustomerId: null });

        const res = await post(app, validBody(ws.id), await memberToken());
        expect(res.statusCode).toBe(404);
        expect(res.json()).toEqual({ error: 'No subscription found for this workspace' });
        expect(deps.stripe.portalSessions).toHaveLength(0);
    });

    it('contributes workspace.id and user_id to the canonical request event', async () => {
        const lines: Record<string, unknown>[] = [];
        const deps = createFakeDeps({ db: pool });
        const app = buildApp(deps, {
            supabaseJwtSecret: TEST_JWT_SECRET,
            logStream: {
                write(chunk: string) {
                    for (const line of chunk.split('\n')) {
                        if (line.trim()) lines.push(JSON.parse(line));
                    }
                },
            },
        });
        const ws = await seedWs(); // owner (implicit member): SEEDED_USER_ID
        await seedSubscription(pool, { workspaceId: ws.id });

        const res = await post(app, validBody(ws.id), await memberToken());
        expect(res.statusCode).toBe(200);
        expect(lines.find((l) => l.msg === 'request')).toMatchObject({
            'http.route': '/stripe-portal',
            'http.response.status_code': 200,
            'workspace.id': ws.id,
            user_id: SEEDED_USER_ID,
        });
    });

    it('is read-only: workspace, membership and subscription rows are unchanged', async () => {
        const { app } = testApp();
        const ws = await seedWs(); // owner (implicit member): SEEDED_USER_ID
        await seedWorkspaceMember(pool, { workspaceId: ws.id, userId: SEEDED_USER_2_ID, role: 'viewer' });
        await seedSubscription(pool, { workspaceId: ws.id });

        const snapshot = () =>
            pool.query(
                `SELECT w.updated_at, wm.updated_at AS member_updated_at, s.*
                 FROM workspaces w
                 JOIN workspace_members wm ON wm.workspace_id = w.id
                 JOIN subscriptions s ON s.workspace_id = w.id
                 WHERE w.id = $1`,
                [ws.id],
            );

        const before = await snapshot();
        const res = await post(app, validBody(ws.id), await memberToken());
        expect(res.statusCode).toBe(200);
        const after = await snapshot();
        expect(after.rows).toEqual(before.rows);
    });
});
