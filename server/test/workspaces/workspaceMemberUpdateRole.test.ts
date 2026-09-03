/**
 * POST /workspace-member-update-role — Part 2 Batch 3; revamp Step 6:
 * crossing the viewer↔(creator|admin) boundary moves the billed seat
 * count — promotions are gated on an active subscription and both
 * directions sync the Stripe quantity to the COMPUTED count.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
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

async function post(app: App, body: unknown, token?: string) {
    return app.inject({
        method: 'POST',
        url: '/workspace-member-update-role',
        headers: token ? { authorization: `Bearer ${token}` } : {},
        payload: body as Record<string, unknown>,
    });
}

describe('POST /workspace-member-update-role (auth + validation, no db)', () => {
    function validationApp() {
        return buildApp(createFakeDeps(), { supabaseJwtSecret: TEST_JWT_SECRET, logLevel: 'silent' });
    }

    it('401 without a token', async () => {
        const res = await post(validationApp(), { workspaceId: 'x', userId: 'y', role: 'viewer' });
        expect(res.statusCode).toBe(401);
    });

    it('schema 400 pre-query: invalid role', async () => {
        const res = await post(validationApp(),
            { workspaceId: 'x', userId: 'y', role: 'owner' }, await userToken());
        expect(res.statusCode).toBe(400);
    });
});

describe.runIf(hasTestDb())('POST /workspace-member-update-role (e2e, real Postgres)', () => {
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
            logLevel: 'silent',
        });
        return { app, deps };
    }

    async function workspaceWithBoth(opts: { memberRole?: 'viewer' | 'creator' | 'admin'; subscribed?: boolean } = {}) {
        const ws = await seedWorkspace(pool); // owner (implicit admin): SEEDED_USER_ID
        createdWorkspaces.push(ws.id);
        await seedWorkspaceMember(pool, {
            workspaceId: ws.id, userId: SEEDED_USER_2_ID, role: opts.memberRole ?? 'viewer',
        });
        const stripeSubscriptionId = `sub_role_${randomUUID().slice(0, 8)}`;
        if (opts.subscribed !== false) {
            await seedSubscription(pool, { workspaceId: ws.id, stripeSubscriptionId });
        }
        return { ...ws, stripeSubscriptionId };
    }

    function seedFakeSub(deps: FakeDeps, stripeSubscriptionId: string, quantity: number) {
        deps.stripe.subscriptions.set(stripeSubscriptionId, {
            id: stripeSubscriptionId,
            status: 'active',
            customer: 'cus_role_test',
            items: {
                data: [{
                    id: 'si_role_1',
                    quantity,
                    current_period_end: 1800000000,
                    price: { id: 'price_m', unit_amount: 1500, recurring: { interval: 'month' } },
                }],
            },
        });
    }

    it('403 for a non-admin caller; role untouched', async () => {
        const ws = await workspaceWithBoth();
        const res = await post(testApp().app,
            { workspaceId: ws.id, userId: SEEDED_USER_2_ID, role: 'admin' },
            await userToken({ sub: SEEDED_USER_2_ID }));
        expect(res.statusCode).toBe(403);

        const { rows } = await pool.query(
            'SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
            [ws.id, SEEDED_USER_2_ID]);
        expect(rows).toEqual([{ role: 'viewer' }]);
    });

    it("409 changing the owner's role", async () => {
        const ws = await workspaceWithBoth();
        const res = await post(testApp().app,
            { workspaceId: ws.id, userId: SEEDED_USER_ID, role: 'viewer' },
            await userToken({ sub: SEEDED_USER_ID }));
        expect(res.statusCode).toBe(409);
        expect(res.json()).toEqual({ error: 'Cannot change the role of the workspace owner' });
    });

    it('404 for a non-member target', async () => {
        const ws = await workspaceWithBoth();
        const res = await post(testApp().app,
            { workspaceId: ws.id, userId: randomUUID(), role: 'viewer' },
            await userToken({ sub: SEEDED_USER_ID }));
        expect(res.statusCode).toBe(404);
    });

    it('viewer→creator promotion: 200, quantity synced UP to the computed count', async () => {
        const ws = await workspaceWithBoth();
        const { app, deps } = testApp();
        seedFakeSub(deps, ws.stripeSubscriptionId, 1);

        const res = await post(app,
            { workspaceId: ws.id, userId: SEEDED_USER_2_ID, role: 'creator' },
            await userToken({ sub: SEEDED_USER_ID }));
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ ok: true });

        const { rows } = await pool.query(
            'SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
            [ws.id, SEEDED_USER_2_ID]);
        expect(rows).toEqual([{ role: 'creator' }]);
        expect(deps.stripe.subscriptionUpdates).toEqual([{
            id: ws.stripeSubscriptionId,
            params: {
                items: [{ id: 'si_role_1', quantity: 2 }],
                proration_behavior: 'always_invoice',
            },
        }]);
        expect(deps.email.sent).toHaveLength(1);
        expect(deps.email.sent[0].to).toBe('user1@gmail.com');
    });

    it('creator→viewer downgrade: quantity synced DOWN (removal credits the balance)', async () => {
        const ws = await workspaceWithBoth({ memberRole: 'creator' });
        const { app, deps } = testApp();
        seedFakeSub(deps, ws.stripeSubscriptionId, 2);

        const res = await post(app,
            { workspaceId: ws.id, userId: SEEDED_USER_2_ID, role: 'viewer' },
            await userToken({ sub: SEEDED_USER_ID }));
        expect(res.statusCode).toBe(200);

        expect(deps.stripe.subscriptionUpdates).toEqual([{
            id: ws.stripeSubscriptionId,
            params: {
                items: [{ id: 'si_role_1', quantity: 1 }],
                proration_behavior: 'always_invoice',
            },
        }]);
        const { rows } = await pool.query(
            'SELECT seats FROM subscriptions WHERE workspace_id = $1', [ws.id]);
        expect(rows).toEqual([{ seats: 1 }]);
    });

    it('admin→creator stays inside the billed boundary: no Stripe call', async () => {
        const ws = await workspaceWithBoth({ memberRole: 'admin' });
        const { app, deps } = testApp();
        seedFakeSub(deps, ws.stripeSubscriptionId, 2);

        const res = await post(app,
            { workspaceId: ws.id, userId: SEEDED_USER_2_ID, role: 'creator' },
            await userToken({ sub: SEEDED_USER_ID }));
        expect(res.statusCode).toBe(200);
        expect(deps.stripe.subscriptionUpdates).toEqual([]);
        expect(deps.email.sent).toEqual([]);
    });

    it('403 promoting on a workspace without an active subscription; role untouched', async () => {
        const ws = await workspaceWithBoth({ subscribed: false });
        const res = await post(testApp().app,
            { workspaceId: ws.id, userId: SEEDED_USER_2_ID, role: 'creator' },
            await userToken({ sub: SEEDED_USER_ID }));
        expect(res.statusCode).toBe(403);
        expect(res.json()).toEqual({ error: 'Promoting members requires an active subscription' });

        const { rows } = await pool.query(
            'SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
            [ws.id, SEEDED_USER_2_ID]);
        expect(rows).toEqual([{ role: 'viewer' }]);
    });

    it('creator→viewer downgrade on a lapsed workspace still works (shrinking is never gated)', async () => {
        const ws = await workspaceWithBoth({ memberRole: 'creator', subscribed: false });
        const res = await post(testApp().app,
            { workspaceId: ws.id, userId: SEEDED_USER_2_ID, role: 'viewer' },
            await userToken({ sub: SEEDED_USER_ID }));
        expect(res.statusCode).toBe(200);

        const { rows } = await pool.query(
            'SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
            [ws.id, SEEDED_USER_2_ID]);
        expect(rows).toEqual([{ role: 'viewer' }]);
    });
});
