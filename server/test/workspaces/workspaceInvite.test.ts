/**
 * POST /workspace-invite — Part 2 Batch 3.
 * Pins: fresh-invitation insert (lowercased email), re-invite replaces
 * the prior row, and the email leg is fire-and-forget — a failing email
 * send never fails the invite (pg_net parity), success sends via the
 * shared service.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
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

    async function adminWorkspace() {
        const ws = await seedWorkspace(pool); // owner (implicit admin): SEEDED_USER_ID
        createdWorkspaces.push(ws.id);
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
