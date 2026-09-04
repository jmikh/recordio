/**
 * /admin-user-list + /admin-impersonate
 * (plans/admin-user-impersonation-oneshot.md).
 *
 * Unit tier: ADMIN_EMAILS gating — 401 without a token, 403 for
 * non-admins, fail-closed without an allowlist, case-insensitive match.
 * E2e tier: list content + activity ordering, minting, and the minted
 * token authenticating as the target on an existing route.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decodeJwt } from 'jose';
import type pg from 'pg';
import { buildApp, type App } from '../src/app.js';
import { createFakeDeps } from './fakes/index.js';
import { TEST_JWT_SECRET, userToken } from './helpers/tokens.js';
import {
    createTestPool,
    deleteAuthUsers,
    deleteProjects,
    hasTestDb,
    seedAuthUser,
    seedProject,
} from './helpers/db.js';

const ADMIN_EMAIL = 'admin@example.com';

function post(app: App, url: string, token?: string, payload: Record<string, unknown> = {}) {
    return app.inject({
        method: 'POST',
        url,
        headers: token ? { authorization: `Bearer ${token}` } : {},
        payload,
    });
}

describe('admin routes (auth, no db)', () => {
    function app(adminEmails?: string) {
        return buildApp(createFakeDeps(), {
            supabaseJwtSecret: TEST_JWT_SECRET,
            logLevel: 'silent',
            adminEmails,
        });
    }

    it('401 without a token', async () => {
        const res = await post(app(ADMIN_EMAIL), '/admin-user-list');
        expect(res.statusCode).toBe(401);
    });

    it('403 for a non-admin user on both routes', async () => {
        const token = await userToken({ email: 'someone@else.com' });
        const list = await post(app(ADMIN_EMAIL), '/admin-user-list', token);
        expect(list.statusCode).toBe(403);
        const mint = await post(app(ADMIN_EMAIL), '/admin-impersonate', token, { userId: 'x' });
        expect(mint.statusCode).toBe(403);
    });

    it('403 when no allowlist is configured (fail closed)', async () => {
        const res = await post(app(undefined), '/admin-user-list', await userToken({ email: ADMIN_EMAIL }));
        expect(res.statusCode).toBe(403);
    });

    it('matches allowlist entries case-insensitively and trimmed', async () => {
        // Getting PAST the gate reaches the throwing fake db → 500, not 403
        const res = await post(
            app(' other@example.com , ADMIN@Example.COM '),
            '/admin-user-list',
            await userToken({ email: 'Admin@EXAMPLE.com' }),
        );
        expect(res.statusCode).toBe(500);
    });
});

describe.runIf(hasTestDb())('admin routes (e2e, real Postgres)', () => {
    let pool: pg.Pool;
    const createdUsers: string[] = [];
    const createdProjects: string[] = [];

    beforeAll(() => {
        pool = createTestPool();
    });
    afterAll(async () => {
        await deleteProjects(pool, createdProjects);
        // Kept bootstrap workspaces block the auth.users delete (owner_id FK)
        if (createdUsers.length > 0) {
            await pool.query('DELETE FROM workspaces WHERE owner_id = ANY($1::uuid[])', [createdUsers]);
        }
        await deleteAuthUsers(pool, createdUsers);
        await pool.end();
    });

    function testApp() {
        const deps = createFakeDeps({ db: pool });
        // Minted-token exp is computed off deps.clock — align it with real
        // time so the token verifies when replayed against another route
        deps.clock.set(new Date());
        return buildApp(deps, {
            supabaseJwtSecret: TEST_JWT_SECRET,
            logLevel: 'silent',
            adminEmails: ADMIN_EMAIL,
        });
    }

    it('lists users most-recently-active first with project counts', async () => {
        const active = await seedAuthUser(pool, { name: 'Active User', keepBootstrapWorkspace: true });
        const dormant = await seedAuthUser(pool, { name: 'Dormant User' });
        createdUsers.push(active.id, dormant.id);
        const project = await seedProject(pool, {
            ownerId: active.id,
            updatedAt: new Date().toISOString(),
        });
        createdProjects.push(project.id);

        const res = await post(testApp(), '/admin-user-list', await userToken({ email: ADMIN_EMAIL }));
        expect(res.statusCode).toBe(200);
        const { users } = res.json() as {
            users: Array<{
                id: string;
                email: string | null;
                name: string | null;
                last_active_at: string | null;
                project_count: number;
            }>;
        };

        const activeRow = users.find(u => u.id === active.id);
        const dormantRow = users.find(u => u.id === dormant.id);
        expect(activeRow).toBeDefined();
        expect(dormantRow).toBeDefined();
        expect(activeRow!.name).toBe('Active User');
        expect(activeRow!.project_count).toBe(1);
        expect(activeRow!.last_active_at).not.toBeNull();
        expect(dormantRow!.project_count).toBe(0);
        // The freshly-updated project puts the active user ahead of the dormant one
        expect(users.findIndex(u => u.id === active.id))
            .toBeLessThan(users.findIndex(u => u.id === dormant.id));
    });

    it('404 for an unknown target (malformed id included)', async () => {
        const res = await post(
            testApp(),
            '/admin-impersonate',
            await userToken({ email: ADMIN_EMAIL }),
            { userId: 'no-such-user' },
        );
        expect(res.statusCode).toBe(404);
    });

    it('mints a token that authenticates as the target', async () => {
        const target = await seedAuthUser(pool, { name: 'Impersonated Person' });
        createdUsers.push(target.id);

        const app = testApp();
        const res = await post(
            app,
            '/admin-impersonate',
            await userToken({ sub: 'admin-user-id', email: ADMIN_EMAIL }),
            { userId: target.id },
        );
        expect(res.statusCode).toBe(200);
        const { token, expiresAt, targetUser } = res.json() as {
            token: string;
            expiresAt: string;
            targetUser: { id: string; email: string | null; name: string | null };
        };
        expect(targetUser).toEqual({ id: target.id, email: target.email, name: 'Impersonated Person' });
        expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now());

        const claims = decodeJwt(token);
        expect(claims.sub).toBe(target.id);
        expect(claims.role).toBe('authenticated');
        expect(claims.impersonated_by).toBe('admin-user-id');

        // The minted token IS a session for the target on existing routes
        const profile = await post(app, '/user-profile-get', token);
        expect(profile.statusCode).toBe(200);
        expect(profile.json()).toEqual({ name: 'Impersonated Person', has_reviewed: false });
    });
});
