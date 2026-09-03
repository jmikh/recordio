/**
 * POST /workspace-invite — Part 2 Batch 3; revamp Step 6 gates.
 * Pins: fresh-invitation insert (lowercased email), re-invite replaces
 * the prior row, and the email leg is fire-and-forget — a failing email
 * send never fails the invite (pg_net parity), success sends via the
 * shared service. Step 6: inviting requires an active subscription
 * (free AND trial are solo — trials never unlock collaboration;
 * past_due keeps rights through dunning); viewer invites respect the
 * hidden VIEWER_CEILING (pending viewer invites count toward it).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import { buildApp, type App } from '../../src/app.js';
import { VIEWER_CEILING } from '../../src/services/seatBilling.js';
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
        url: '/workspace-invite',
        headers: token ? { authorization: `Bearer ${token}` } : {},
        payload: body as Record<string, unknown>,
    });
}

describe('POST /workspace-invite (auth + validation, no db)', () => {
    function validationApp() {
        return buildApp(createFakeDeps(), { supabaseJwtSecret: TEST_JWT_SECRET, logLevel: 'silent' });
    }

    it('401 without a token', async () => {
        const res = await post(validationApp(), { workspaceId: 'x', email: 'a@b.c', role: 'viewer' });
        expect(res.statusCode).toBe(401);
    });

    it.each([
        ['missing email', { workspaceId: 'x', role: 'viewer' }],
        ['invalid role', { workspaceId: 'x', email: 'a@b.c', role: 'owner' }],
    ])('schema 400 pre-query: %s', async (_name, body) => {
        const res = await post(validationApp(), body, await userToken());
        expect(res.statusCode).toBe(400);
    });
});

describe.runIf(hasTestDb())('POST /workspace-invite (e2e, real Postgres)', () => {
    let pool: pg.Pool;
    const createdWorkspaces: string[] = [];

    beforeAll(() => {
        pool = createTestPool();
    });
    afterAll(async () => {
        await deleteWorkspaces(pool, createdWorkspaces);
        await pool.end();
    });

    function testApp() {
        const lines: Record<string, unknown>[] = [];
        const deps: FakeDeps = createFakeDeps({ db: pool });
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
        return { app, deps, lines };
    }

    async function adminWorkspace(subscriptionStatus: string | null = 'active') {
        const ws = await seedWorkspace(pool); // owner (implicit admin): SEEDED_USER_ID
        createdWorkspaces.push(ws.id);
        // Inviting requires an active subscription (revamp Step 6)
        if (subscriptionStatus !== null) {
            await seedSubscription(pool, { workspaceId: ws.id, status: subscriptionStatus });
        }
        return ws;
    }

    it("409 for the workspace owner's own email; no invitation created", async () => {
        // Owner has no workspace_members row (revamp Step 2) — without
        // the guard, accepting this invite would create one.
        const ws = await adminWorkspace();

        const { app } = testApp();
        const res = await post(app, { workspaceId: ws.id, email: 'User1@Gmail.com', role: 'admin' },
            await userToken({ sub: SEEDED_USER_ID }));
        expect(res.statusCode).toBe(409);
        expect(res.json()).toEqual({ error: 'This email belongs to the workspace owner' });

        const { rows } = await pool.query(
            'SELECT 1 FROM workspace_invitations WHERE workspace_id = $1', [ws.id]);
        expect(rows).toHaveLength(0);
    });

    it('403 for a non-admin; no invitation created', async () => {
        const ws = await adminWorkspace();
        await seedWorkspaceMember(pool, { workspaceId: ws.id, userId: SEEDED_USER_2_ID, role: 'creator' });

        const { app } = testApp();
        const res = await post(app, { workspaceId: ws.id, email: 'x@y.z', role: 'viewer' },
            await userToken({ sub: SEEDED_USER_2_ID }));
        expect(res.statusCode).toBe(403);

        const { rows } = await pool.query(
            'SELECT 1 FROM workspace_invitations WHERE workspace_id = $1', [ws.id]);
        expect(rows).toEqual([]);
    });

    it.each([
        ['free (no subscription)', null],
        ['lapsed (canceled subscription)', 'canceled'],
    ])('403 on a %s workspace — inviting requires an active subscription', async (_name, status) => {
        const ws = await adminWorkspace(status);

        const { app } = testApp();
        const res = await post(app, { workspaceId: ws.id, email: 'x@y.z', role: 'creator' },
            await userToken({ sub: SEEDED_USER_ID }));
        expect(res.statusCode).toBe(403);
        expect(res.json()).toEqual({ error: 'Inviting members requires an active subscription' });

        const { rows } = await pool.query(
            'SELECT 1 FROM workspace_invitations WHERE workspace_id = $1', [ws.id]);
        expect(rows).toEqual([]);
    });

    it('403 on a live-trial workspace — trials never unlock collaboration', async () => {
        const ws = await seedWorkspace(pool, { trialEndsAt: '2100-01-01T00:00:00Z' });
        createdWorkspaces.push(ws.id);

        const { app } = testApp();
        const res = await post(app, { workspaceId: ws.id, email: 'x@y.z', role: 'creator' },
            await userToken({ sub: SEEDED_USER_ID }));
        expect(res.statusCode).toBe(403);
        expect(res.json()).toEqual({ error: 'Inviting members requires an active subscription' });
    });

    it('200 during dunning (past_due keeps invite rights)', async () => {
        const ws = await adminWorkspace('past_due');

        const { app } = testApp();
        const res = await post(app, { workspaceId: ws.id, email: 'x@y.z', role: 'creator' },
            await userToken({ sub: SEEDED_USER_ID }));
        expect(res.statusCode).toBe(200);
    });

    it('viewer ceiling: pending viewer invites count; re-inviting one of them does not self-block', async () => {
        const ws = await adminWorkspace();
        await pool.query(
            `INSERT INTO workspace_invitations (workspace_id, email, role, invited_by, token, status)
             SELECT $1, 'v' || i || '@example.com', 'viewer', $2, gen_random_uuid(), 'pending'
             FROM generate_series(1, $3::int) i`,
            [ws.id, SEEDED_USER_ID, VIEWER_CEILING],
        );

        const { app } = testApp();
        const t = await userToken({ sub: SEEDED_USER_ID });
        const blocked = await post(app, { workspaceId: ws.id, email: 'one-more@example.com', role: 'viewer' }, t);
        expect(blocked.statusCode).toBe(403);
        expect(blocked.json()).toEqual({ error: 'Viewer limit reached — contact support to increase it' });

        // Creator invites are untouched by the viewer ceiling
        const creator = await post(app, { workspaceId: ws.id, email: 'creator@example.com', role: 'creator' }, t);
        expect(creator.statusCode).toBe(200);

        // Re-inviting an already-pending viewer replaces their row — it
        // must not count itself toward the ceiling
        const reinvite = await post(app, { workspaceId: ws.id, email: 'v1@example.com', role: 'viewer' }, t);
        expect(reinvite.statusCode).toBe(200);
    });

    it('creates the invitation (lowercased email), returns id+token, and sends the email in-process', async () => {
        const ws = await adminWorkspace();
        const { app, deps } = testApp();

        const res = await post(app, { workspaceId: ws.id, email: 'Friend@Example.COM', role: 'creator' },
            await userToken({ sub: SEEDED_USER_ID }));
        expect(res.statusCode).toBe(200);
        const { invitationId, token } = res.json() as { invitationId: string; token: string };

        const { rows } = await pool.query(
            `SELECT email, role, status, invited_by FROM workspace_invitations WHERE id = $1`,
            [invitationId],
        );
        expect(rows[0]).toEqual({
            email: 'friend@example.com',
            role: 'creator',
            status: 'pending',
            invited_by: SEEDED_USER_ID,
        });

        // Fire-and-forget email — wait for the async leg to land
        await vi.waitFor(() => expect(deps.email.sent.length).toBe(1));
        expect(deps.email.sent[0].to).toBe('friend@example.com');
        expect(deps.email.sent[0].html).toContain(`token=${token}`);
    });

    it('re-invite deletes the prior invitation for that email', async () => {
        const ws = await adminWorkspace();
        const { app } = testApp();
        const t = await userToken({ sub: SEEDED_USER_ID });

        const first = (await post(app, { workspaceId: ws.id, email: 'again@example.com', role: 'viewer' }, t))
            .json() as { invitationId: string };
        const second = (await post(app, { workspaceId: ws.id, email: 'Again@example.com', role: 'admin' }, t))
            .json() as { invitationId: string };

        const { rows } = await pool.query(
            `SELECT id, role FROM workspace_invitations
             WHERE workspace_id = $1 AND email = 'again@example.com'`,
            [ws.id],
        );
        expect(rows).toEqual([{ id: second.invitationId, role: 'admin' }]);
        expect(second.invitationId).not.toBe(first.invitationId);
    });

    it('a failing email send never fails the invite (fire-and-forget pin)', async () => {
        const ws = await adminWorkspace();
        const { app, deps, lines } = testApp();
        deps.email.nextResult = { success: false, error: 'resend down' };

        const res = await post(app, { workspaceId: ws.id, email: 'doomed@example.com', role: 'viewer' },
            await userToken({ sub: SEEDED_USER_ID }));
        expect(res.statusCode).toBe(200);

        const { rows } = await pool.query(
            `SELECT status FROM workspace_invitations WHERE workspace_id = $1 AND email = 'doomed@example.com'`,
            [ws.id],
        );
        expect(rows).toEqual([{ status: 'pending' }]);

        await vi.waitFor(() => expect(
            lines.some((l) => l.msg === 'workspace invite email failed'),
        ).toBe(true));
    });
});
