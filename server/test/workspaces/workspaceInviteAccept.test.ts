/**
 * POST /workspace-invite-accept — Part 2 Batch 3; revamp Step 6.
 * Business failures come back as 200 + { error } with the SQL fn's
 * EXACT messages (AcceptInvitePage displays them). Dedicated auth users
 * — accepting mutates default_workspace_id, and the email-match check
 * needs the token's email claim to line up with the invitation.
 *
 * Step 6: acceptance requires the workspace to still be pro (lapse
 * guard); creator/admin acceptance syncs the Stripe quantity to the
 * COMPUTED billed count + emails the plan owner; viewers never touch
 * Stripe; a Stripe failure never fails the join (load-bearing pin).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { buildApp, type App } from '../../src/app.js';
import { createFakeDeps, type FakeDeps } from '../fakes/index.js';
import { TEST_JWT_SECRET, userToken } from '../helpers/tokens.js';
import {
    createTestPool,
    deleteAuthUsers,
    deleteWorkspaces,
    getDefaultWorkspaceId,
    hasTestDb,
    seedAuthUser,
    seedSubscription,
    seedWorkspace,
    seedWorkspaceInvitation,
    seedWorkspaceMember,
} from '../helpers/db.js';

async function post(app: App, body: unknown, token?: string) {
    return app.inject({
        method: 'POST',
        url: '/workspace-invite-accept',
        headers: token ? { authorization: `Bearer ${token}` } : {},
        payload: body as Record<string, unknown>,
    });
}

describe('POST /workspace-invite-accept (auth + validation, no db)', () => {
    function validationApp() {
        return buildApp(createFakeDeps(), { supabaseJwtSecret: TEST_JWT_SECRET, logLevel: 'silent' });
    }

    it('401 without a token', async () => {
        const res = await post(validationApp(), { token: 'x' });
        expect(res.statusCode).toBe(401);
    });

    it('schema 400 pre-query: missing token', async () => {
        const res = await post(validationApp(), {}, await userToken());
        expect(res.statusCode).toBe(400);
    });
});

describe.runIf(hasTestDb())('POST /workspace-invite-accept (e2e, real Postgres)', () => {
    let pool: pg.Pool;
    const createdUsers: string[] = [];
    const createdWorkspaces: string[] = [];

    beforeAll(() => {
        pool = createTestPool();
    });
    afterAll(async () => {
        await deleteWorkspaces(pool, createdWorkspaces);
        await deleteAuthUsers(pool, createdUsers);
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

    async function freshUser() {
        const user = await seedAuthUser(pool);
        createdUsers.push(user.id);
        return user;
    }

    /**
     * Pro workspace (owner SEEDED_USER_ID = user1@gmail.com) with a
     * Stripe-linked subscription — acceptance requires pro since Step 6.
     * Seed the returned stripeSubscriptionId into the fake Stripe map
     * (seat sync reads it) via seedFakeSub.
     */
    async function freshWorkspace(opts: { status?: string } = {}) {
        const ws = await seedWorkspace(pool);
        createdWorkspaces.push(ws.id);
        const stripeSubscriptionId = `sub_accept_${randomUUID().slice(0, 8)}`;
        await seedSubscription(pool, {
            workspaceId: ws.id,
            status: opts.status ?? 'active',
            stripeSubscriptionId,
        });
        return { ...ws, stripeSubscriptionId };
    }

    function seedFakeSub(deps: FakeDeps, stripeSubscriptionId: string, quantity = 1) {
        deps.stripe.subscriptions.set(stripeSubscriptionId, {
            id: stripeSubscriptionId,
            status: 'active',
            customer: 'cus_accept_test',
            items: {
                data: [{
                    id: 'si_accept_1',
                    quantity,
                    current_period_end: 1800000000,
                    price: { id: 'price_m', unit_amount: 1500, recurring: { interval: 'month' } },
                }],
            },
        });
    }

    it("unknown token → 200 { error: 'Invitation not found or already used' }", async () => {
        const user = await freshUser();
        const res = await post(testApp().app, { token: randomUUID() },
            await userToken({ sub: user.id, email: user.email }));
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ error: 'Invitation not found or already used' });
    });

    it('email mismatch → the exact user-facing message; nothing joined', async () => {
        const user = await freshUser();
        const ws = await freshWorkspace();
        const inv = await seedWorkspaceInvitation(pool, {
            workspaceId: ws.id, email: 'someone-else@example.com',
        });

        const res = await post(testApp().app, { token: inv.token },
            await userToken({ sub: user.id, email: user.email }));
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ error: 'This invitation was sent to a different email address' });

        const { rows } = await pool.query(
            'SELECT 1 FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
            [ws.id, user.id],
        );
        expect(rows).toEqual([]);
    });

    it('accepts: joins with the invitation role, marks accepted, sets the default workspace; a second accept fails used', async () => {
        const user = await freshUser();
        const ws = await freshWorkspace();
        const inv = await seedWorkspaceInvitation(pool, {
            workspaceId: ws.id, email: user.email.toUpperCase(), role: 'creator',
        });

        const { app, deps } = testApp();
        seedFakeSub(deps, ws.stripeSubscriptionId);
        const t = await userToken({ sub: user.id, email: user.email });
        const res = await post(app, { token: inv.token }, t);
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ workspaceId: ws.id, role: 'creator' });

        const { rows: memberRows } = await pool.query(
            'SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
            [ws.id, user.id],
        );
        expect(memberRows).toEqual([{ role: 'creator' }]);
        const { rows: invRows } = await pool.query(
            'SELECT status FROM workspace_invitations WHERE id = $1', [inv.id]);
        expect(invRows).toEqual([{ status: 'accepted' }]);
        expect(await getDefaultWorkspaceId(pool, user.id)).toBe(ws.id);

        const again = await post(testApp().app, { token: inv.token }, t);
        expect(again.json()).toEqual({ error: 'Invitation not found or already used' });
    });

    it('creator acceptance syncs the Stripe quantity to the COMPUTED count, updates DB seats, emails the plan owner', async () => {
        const user = await freshUser();
        const ws = await freshWorkspace();
        const inv = await seedWorkspaceInvitation(pool, {
            workspaceId: ws.id, email: user.email, role: 'creator',
        });

        const { app, deps } = testApp();
        seedFakeSub(deps, ws.stripeSubscriptionId, 1);
        const res = await post(app, { token: inv.token },
            await userToken({ sub: user.id, email: user.email }));
        expect(res.statusCode).toBe(200);

        // Quantity SET to computed (owner 1 + creator 1), never incremented
        expect(deps.stripe.subscriptionUpdates).toEqual([{
            id: ws.stripeSubscriptionId,
            params: {
                items: [{ id: 'si_accept_1', quantity: 2 }],
                proration_behavior: 'always_invoice',
            },
        }]);
        const { rows } = await pool.query(
            'SELECT seats FROM subscriptions WHERE workspace_id = $1', [ws.id]);
        expect(rows).toEqual([{ seats: 2 }]);

        // Seat-change email to the plan owner (seeded owner = user1)
        expect(deps.email.sent).toHaveLength(1);
        expect(deps.email.sent[0].to).toBe('user1@gmail.com');
        expect(deps.email.sent[0].subject).toContain('your plan is now 2 seats');
        expect(deps.email.sent[0].html).toContain('$30/month');
    });

    it('viewer acceptance never touches Stripe and sends no email', async () => {
        const user = await freshUser();
        const ws = await freshWorkspace();
        const inv = await seedWorkspaceInvitation(pool, {
            workspaceId: ws.id, email: user.email, role: 'viewer',
        });

        const { app, deps } = testApp();
        seedFakeSub(deps, ws.stripeSubscriptionId);
        const res = await post(app, { token: inv.token },
            await userToken({ sub: user.id, email: user.email }));
        expect(res.json()).toEqual({ workspaceId: ws.id, role: 'viewer' });

        expect(deps.stripe.subscriptionUpdates).toEqual([]);
        expect(deps.email.sent).toEqual([]);
    });

    it("lapsed workspace → 200 { error }, no member row (Step 6 lapse guard)", async () => {
        const user = await freshUser();
        const ws = await freshWorkspace({ status: 'canceled' });
        const inv = await seedWorkspaceInvitation(pool, {
            workspaceId: ws.id, email: user.email, role: 'creator',
        });

        const res = await post(testApp().app, { token: inv.token },
            await userToken({ sub: user.id, email: user.email }));
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ error: "This workspace's subscription is no longer active" });

        const { rows } = await pool.query(
            'SELECT 1 FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
            [ws.id, user.id]);
        expect(rows).toEqual([]);
    });

    it('a Stripe failure never fails the join (load-bearing pin)', async () => {
        const user = await freshUser();
        const ws = await freshWorkspace();
        const inv = await seedWorkspaceInvitation(pool, {
            workspaceId: ws.id, email: user.email, role: 'creator',
        });

        // Fake Stripe has NO subscription seeded → getSubscription throws
        const { app, deps } = testApp();
        const res = await post(app, { token: inv.token },
            await userToken({ sub: user.id, email: user.email }));
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ workspaceId: ws.id, role: 'creator' });

        const { rows } = await pool.query(
            'SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
            [ws.id, user.id]);
        expect(rows).toEqual([{ role: 'creator' }]);
        expect(deps.stripe.subscriptionUpdates).toEqual([]);
        expect(deps.email.sent).toEqual([]);
    });

    it('owner accepting an invite to their OWN workspace → error, no member row created', async () => {
        // Stale pre-guard invitations for the owner's email must not
        // recreate an owner member row (revamp Step 2: owner is its own
        // state, never in workspace_members).
        const user = await freshUser();
        const ws = await seedWorkspace(pool, { ownerId: user.id });
        createdWorkspaces.push(ws.id);
        const inv = await seedWorkspaceInvitation(pool, {
            workspaceId: ws.id, email: user.email, role: 'creator',
        });

        const res = await post(testApp().app, { token: inv.token },
            await userToken({ sub: user.id, email: user.email }));
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ error: 'You already own this workspace' });

        const { rows } = await pool.query(
            'SELECT 1 FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
            [ws.id, user.id]);
        expect(rows).toHaveLength(0);
    });

    it('re-inviting an existing member UPSERTS their role', async () => {
        const user = await freshUser();
        const ws = await freshWorkspace();
        await seedWorkspaceMember(pool, { workspaceId: ws.id, userId: user.id, role: 'viewer' });
        const inv = await seedWorkspaceInvitation(pool, {
            workspaceId: ws.id, email: user.email, role: 'admin',
        });

        const { app, deps } = testApp();
        seedFakeSub(deps, ws.stripeSubscriptionId);
        const res = await post(app, { token: inv.token },
            await userToken({ sub: user.id, email: user.email }));
        expect(res.json()).toEqual({ workspaceId: ws.id, role: 'admin' });

        const { rows } = await pool.query(
            'SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
            [ws.id, user.id],
        );
        expect(rows).toEqual([{ role: 'admin' }]);
        // viewer → admin crosses the billed boundary: quantity synced to 2
        expect(deps.stripe.subscriptionUpdates).toEqual([{
            id: ws.stripeSubscriptionId,
            params: {
                items: [{ id: 'si_accept_1', quantity: 2 }],
                proration_behavior: 'always_invoice',
            },
        }]);
    });
});
