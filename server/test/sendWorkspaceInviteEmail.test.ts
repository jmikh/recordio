/**
 * POST /send-workspace-invite-email — e2e against the real local
 * Postgres (workspace + user_profiles lookups); fakeEmail +
 * fakeSupabaseApi.
 *
 * Pins the INVITER-NAME FIX (user decision 2026-07-23): the edge fn
 * selected the nonexistent `user_profiles.display_name`, so the inviter
 * name always fell back to the auth email — the server reads the real
 * `name` column (→ auth email → 'Someone').
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { buildApp, type App } from '../src/app.js';
import { createFakeDeps, type FakeDeps } from './fakes/index.js';
import { TEST_JWT_SECRET } from './helpers/tokens.js';
import {
    createTestPool,
    deleteWorkspaces,
    hasTestDb,
    SEEDED_USER_2_ID,
    seedWorkspace,
    setUserProfileName,
} from './helpers/db.js';

const TEST_SUPABASE_URL = 'http://127.0.0.1:54321';
const TEST_SERVICE_ROLE_KEY = 'test-service-role-key';

function build(deps: FakeDeps, logStream?: { write(chunk: string): void }) {
    return buildApp(deps, {
        supabaseJwtSecret: TEST_JWT_SECRET,
        supabaseUrl: TEST_SUPABASE_URL,
        serviceRoleKey: TEST_SERVICE_ROLE_KEY,
        ...(logStream ? { logStream } : { logLevel: 'silent' }),
    });
}

async function post(app: App, payload: unknown, bearer?: string) {
    return app.inject({
        method: 'POST',
        url: '/send-workspace-invite-email',
        headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
        payload: payload as Record<string, unknown>,
    });
}

function inviteBody(overrides: Record<string, unknown> = {}) {
    return {
        workspace_id: randomUUID(),
        email: 'invitee@example.com',
        role: 'creator',
        token: randomUUID(),
        invited_by: SEEDED_USER_2_ID,
        ...overrides,
    };
}

describe('POST /send-workspace-invite-email (auth + validation, no db)', () => {
    it('401 without a bearer — even with a garbage body (auth precedes validation)', async () => {
        const app = build(createFakeDeps());
        const res = await post(app, { nonsense: true });
        expect(res.statusCode).toBe(401);
        expect(res.json()).toEqual({ error: 'Unauthorized' });
    });

    it('401 with the wrong bearer', async () => {
        const app = build(createFakeDeps());
        const res = await post(app, inviteBody(), 'wrong-secret');
        expect(res.statusCode).toBe(401);
    });

    it.each(['workspace_id', 'email', 'role', 'token', 'invited_by'])(
        'schema 400 when %s is missing (edge fn: one Missing fields body)',
        async (field) => {
            const app = build(createFakeDeps());
            const body = inviteBody() as Record<string, unknown>;
            delete body[field];
            const res = await post(app, body, TEST_SERVICE_ROLE_KEY);
            expect(res.statusCode).toBe(400);
        },
    );
});

describe.runIf(hasTestDb())('POST /send-workspace-invite-email (e2e, real Postgres)', () => {
    let pool: pg.Pool;
    const createdWorkspaces: string[] = [];
    const nameRestores: Array<{ userId: string; name: string | null }> = [];

    beforeAll(() => {
        pool = createTestPool();
    });
    afterEach(async () => {
        await deleteWorkspaces(pool, createdWorkspaces);
        createdWorkspaces.length = 0;
        // Profile rows are shared global state — restore what we changed
        for (const { userId, name } of nameRestores.splice(0)) {
            await setUserProfileName(pool, userId, name);
        }
    });
    afterAll(async () => {
        await pool.end();
    });

    function testApp(): { app: App; deps: FakeDeps } {
        const deps = createFakeDeps({ db: pool });
        return { app: build(deps), deps };
    }

    async function nameInviter(name: string | null) {
        const previous = await setUserProfileName(pool, SEEDED_USER_2_ID, name);
        nameRestores.push({ userId: SEEDED_USER_2_ID, name: previous });
    }

    it('INVITER-NAME FIX PIN: uses user_profiles.name (NOT the auth email) + full content', async () => {
        const { app, deps } = testApp();
        const ws = await seedWorkspace(pool, { name: 'Design Team' });
        createdWorkspaces.push(ws.id);
        await nameInviter('Jane Inviter');
        // Auth email present — must NOT be used now that name resolves
        deps.supabaseApi.users.set(SEEDED_USER_2_ID, {
            email: 'jane-auth@example.com',
            userMetadata: {},
        });
        const token = randomUUID();

        const res = await post(
            app,
            inviteBody({ workspace_id: ws.id, token }),
            TEST_SERVICE_ROLE_KEY,
        );

        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ sent: true });
        expect(deps.email.sent).toHaveLength(1);
        const [message] = deps.email.sent;
        expect(message.to).toBe('invitee@example.com');
        expect(message.subject).toBe('Jane Inviter invited you to join Design Team on Recordio');
        expect(message.html).toContain('<strong>Jane Inviter</strong>');
        expect(message.html).toContain('<strong>Design Team</strong>');
        expect(message.html).toContain('<strong>Creator</strong>'); // role label capitalized
        expect(message.html).toContain(`https://app.recordio.io/accept-invite?token=${token}`);
        expect(message.html).not.toContain('jane-auth@example.com');
    });

    it('no profile name → falls back to the auth admin email (the edge fn\'s only working path)', async () => {
        const { app, deps } = testApp();
        const ws = await seedWorkspace(pool, { name: 'Team X' });
        createdWorkspaces.push(ws.id);
        await nameInviter(null);
        deps.supabaseApi.users.set(SEEDED_USER_2_ID, {
            email: 'jane-auth@example.com',
            userMetadata: {},
        });

        await post(app, inviteBody({ workspace_id: ws.id }), TEST_SERVICE_ROLE_KEY);

        expect(deps.email.sent[0].subject).toBe(
            'jane-auth@example.com invited you to join Team X on Recordio',
        );
    });

    it("no profile name and no auth user → 'Someone'", async () => {
        const { app, deps } = testApp();
        const ws = await seedWorkspace(pool, {});
        createdWorkspaces.push(ws.id);
        await nameInviter(null);
        // fakeSupabaseApi has no user seeded → getUserById returns null

        await post(app, inviteBody({ workspace_id: ws.id }), TEST_SERVICE_ROLE_KEY);

        expect(deps.email.sent[0].subject).toMatch(/^Someone invited you/);
    });

    it("getUserById failure degrades to 'Someone' and tags SupabaseApiUnavailable", async () => {
        const lines: Record<string, unknown>[] = [];
        const deps = createFakeDeps({ db: pool });
        deps.supabaseApi.getUserById = async () => {
            throw new Error('supabase down');
        };
        const app = build(deps, {
            write(chunk: string) {
                for (const line of chunk.split('\n')) {
                    if (line.trim()) lines.push(JSON.parse(line));
                }
            },
        });
        const ws = await seedWorkspace(pool, {});
        createdWorkspaces.push(ws.id);
        await nameInviter(null);

        const res = await post(app, inviteBody({ workspace_id: ws.id }), TEST_SERVICE_ROLE_KEY);

        expect(res.statusCode).toBe(200);
        expect(deps.email.sent[0].subject).toMatch(/^Someone invited you/);
        expect(lines.find((l) => l.msg === 'request')).toMatchObject({
            error_type: 'SupabaseApiUnavailable',
        });
    });

    it("unknown workspace → 'a workspace' (parity)", async () => {
        const { app, deps } = testApp();
        await nameInviter('Jane');

        const res = await post(app, inviteBody(), TEST_SERVICE_ROLE_KEY);

        expect(res.statusCode).toBe(200);
        expect(deps.email.sent[0].subject).toBe(
            'Jane invited you to join a workspace on Recordio',
        );
    });

    it('a failed Resend send → 500', async () => {
        const { app, deps } = testApp();
        deps.email.nextResult = { success: false, error: 'rate limited' };
        const ws = await seedWorkspace(pool, {});
        createdWorkspaces.push(ws.id);
        await nameInviter('Jane');

        const res = await post(app, inviteBody({ workspace_id: ws.id }), TEST_SERVICE_ROLE_KEY);
        expect(res.statusCode).toBe(500);
    });

    it('contributes workspace.id and email.template to the canonical event', async () => {
        const lines: Record<string, unknown>[] = [];
        const deps = createFakeDeps({ db: pool });
        const app = build(deps, {
            write(chunk: string) {
                for (const line of chunk.split('\n')) {
                    if (line.trim()) lines.push(JSON.parse(line));
                }
            },
        });
        const ws = await seedWorkspace(pool, {});
        createdWorkspaces.push(ws.id);
        await nameInviter('Jane');

        const res = await post(app, inviteBody({ workspace_id: ws.id }), TEST_SERVICE_ROLE_KEY);
        expect(res.statusCode).toBe(200);

        expect(lines.find((l) => l.msg === 'request')).toMatchObject({
            'http.route': '/send-workspace-invite-email',
            'http.response.status_code': 200,
            'workspace.id': ws.id,
            'email.template': 'workspace-invite',
        });
    });
});
