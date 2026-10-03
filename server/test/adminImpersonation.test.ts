/**
 * /admin-user-list + /admin-project-list + /admin-impersonate
 * (plans/admin-user-impersonation-oneshot.md).
 *
 * Unit tier: ADMIN_EMAILS gating — 401 without a token, 403 for
 * non-admins, fail-closed without an allowlist, case-insensitive match.
 * E2e tier: list content + activity ordering, minting, and the minted
 * token authenticating as the target on an existing route.
 *
 * Plus the read-only confinement of the minted token itself
 * (shared/api/impersonation.ts): reads pass, writes 403, and the reads
 * that pass leave no trace in the target's account.
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

    it('403 for a non-admin user on every admin route', async () => {
        const token = await userToken({ email: 'someone@else.com' });
        for (const route of ['/admin-status', '/admin-growth-stats', '/admin-user-list', '/admin-project-list']) {
            expect((await post(app(ADMIN_EMAIL), route, token)).statusCode, route).toBe(403);
        }
        const mint = await post(app(ADMIN_EMAIL), '/admin-impersonate', token, { userId: 'x' });
        expect(mint.statusCode).toBe(403);
    });

    it('admin-status answers 200 for an admin without touching the db', async () => {
        // The fake db throws — a 200 proves the probe never queries it
        const res = await post(app(ADMIN_EMAIL), '/admin-status', await userToken({ email: ADMIN_EMAIL }));
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ ok: true });
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

    it('lists recent openable projects newest first with owner and feature flags', async () => {
        const owner = await seedAuthUser(pool, { name: 'Project Owner', keepBootstrapWorkspace: true });
        createdUsers.push(owner.id);
        const now = Date.now();
        // Every feature present; duration_ms column unset so the timeline fallback is exercised
        const rich = await seedProject(pool, {
            ownerId: owner.id,
            uploadStatus: 'ready',
            name: 'Rich project',
            updatedAt: new Date(now).toISOString(),
            projectData: {
                cameraSource: { id: 'cam' },
                microphoneSource: { id: 'mic' },
                timeline: {
                    durationMs: 12345.6,
                    captionSegments: [{ id: 'c' }],
                    zoomSegments: [{ id: 'z' }],
                    spotlightSegments: [{ id: 's' }],
                    overlaySegments: [
                        { id: 'o1', item: { type: 'text' } },
                        { id: 'o2', item: { type: 'blur' } },
                    ],
                },
            },
        });
        // Nothing at all (empty project_data) — every probe must survive it
        const bare = await seedProject(pool, {
            ownerId: owner.id,
            uploadStatus: 'ready',
            name: 'Bare project',
            updatedAt: new Date(now - 60_000).toISOString(),
            projectData: {},
        });
        // Not openable: trashed, and upload never finished
        const trashed = await seedProject(pool, {
            ownerId: owner.id,
            uploadStatus: 'ready',
            deletedAt: new Date(now).toISOString(),
            updatedAt: new Date(now).toISOString(),
        });
        const pending = await seedProject(pool, {
            ownerId: owner.id,
            updatedAt: new Date(now).toISOString(),
        });
        createdProjects.push(rich.id, bare.id, trashed.id, pending.id);

        const res = await post(testApp(), '/admin-project-list', await userToken({ email: ADMIN_EMAIL }));
        expect(res.statusCode).toBe(200);
        const { projects } = res.json() as {
            projects: Array<{
                id: string;
                name: string;
                slug: string;
                owner_id: string;
                owner_email: string | null;
                owner_name: string | null;
                duration_ms: number | null;
                has_camera: boolean;
                has_mic: boolean;
                has_captions: boolean;
                has_zooms: boolean;
                has_spotlights: boolean;
                has_blurs: boolean;
            }>;
        };

        const richRow = projects.find(p => p.id === rich.id);
        const bareRow = projects.find(p => p.id === bare.id);
        expect(richRow).toBeDefined();
        expect(bareRow).toBeDefined();
        expect(projects.find(p => p.id === trashed.id)).toBeUndefined();
        expect(projects.find(p => p.id === pending.id)).toBeUndefined();

        expect(richRow).toMatchObject({
            name: 'Rich project',
            slug: rich.slug,
            owner_id: owner.id,
            owner_email: owner.email,
            owner_name: 'Project Owner',
            duration_ms: 12345,
            has_camera: true,
            has_mic: true,
            has_captions: true,
            has_zooms: true,
            has_spotlights: true,
            has_blurs: true,
        });
        expect(bareRow).toMatchObject({
            duration_ms: null,
            has_camera: false,
            has_mic: false,
            has_captions: false,
            has_zooms: false,
            has_spotlights: false,
            has_blurs: false,
        });
        // Newest-updated first
        expect(projects.findIndex(p => p.id === rich.id))
            .toBeLessThan(projects.findIndex(p => p.id === bare.id));
    });

    it('counts signups and project creations per UTC day, sparse and ascending', async () => {
        const user = await seedAuthUser(pool, { name: 'Growth User', keepBootstrapWorkspace: true });
        createdUsers.push(user.id);
        // Two projects on one old day, one deleted — deletion doesn't
        // change that it was created
        const oldDay = '2001-02-03';
        const a = await seedProject(pool, { ownerId: user.id, createdAt: `${oldDay}T10:00:00Z` });
        const b = await seedProject(pool, {
            ownerId: user.id,
            createdAt: `${oldDay}T23:59:59Z`,
            permanentlyDeleted: true,
        });
        createdProjects.push(a.id, b.id);

        const res = await post(testApp(), '/admin-growth-stats', await userToken({ email: ADMIN_EMAIL }));
        expect(res.statusCode).toBe(200);
        const { accounts, projects } = res.json() as {
            accounts: Array<{ day: string; count: number }>;
            projects: Array<{ day: string; count: number }>;
        };

        const today = new Date().toISOString().slice(0, 10);
        const todayAccounts = accounts.find(r => r.day === today);
        expect(todayAccounts).toBeDefined();
        expect(todayAccounts!.count).toBeGreaterThanOrEqual(1);

        const oldProjects = projects.find(r => r.day === oldDay);
        expect(oldProjects).toEqual({ day: oldDay, count: 2 });
        // Ascending by day
        const days = projects.map(r => r.day);
        expect(days).toEqual([...days].sort());
        // Every day listed has at least one row
        expect(projects.every(r => r.count >= 1)).toBe(true);
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

    it('refuses every write on a minted token, allows the reads', async () => {
        const target = await seedAuthUser(pool, { name: 'Read Only', keepBootstrapWorkspace: true });
        createdUsers.push(target.id);
        const project = await seedProject(pool, { ownerId: target.id, uploadStatus: 'ready' });
        createdProjects.push(project.id);

        const app = testApp();
        const { token } = (await post(
            app,
            '/admin-impersonate',
            await userToken({ sub: 'admin-user-id', email: ADMIN_EMAIL }),
            { userId: target.id },
        )).json() as { token: string };

        // Reads the admin needs to look around: allowed
        for (const route of ['/project-get', '/project-list', '/workspace-get-default']) {
            const body = route === '/project-get'
                ? { projectId: project.id }
                : route === '/project-list'
                    ? { workspaceId: (await pool.query('SELECT workspace_id FROM projects WHERE id = $1', [project.id])).rows[0].workspace_id }
                    : {};
            expect((await post(app, route, token, body)).statusCode, route).toBe(200);
        }

        // Every write on the target's account: refused. Bodies are
        // schema-valid on purpose — validation runs BEFORE the preHandler
        // gate, so an invalid one would 400 and prove nothing.
        const writes: Array<[string, Record<string, unknown>]> = [
            ['/project-update', { projectId: project.id, projectData: { hacked: true } }],
            ['/project-update-name', { projectId: project.id, name: 'Renamed' }],
            ['/project-delete', { projectId: project.id }],
            ['/project-share', { projectId: project.id, sharePolicy: 'public' }],
            ['/user-project-defaults-set', { schemaVersion: 1, settings: {} }],
            ['/user-review-set', {}],
            ['/workspace-set-default', { workspaceId: 'w' }],
            ['/transcribe', { projectId: project.id }],
        ];
        for (const [route, body] of writes) {
            const res = await post(app, route, token, body);
            expect(res.statusCode, route).toBe(403);
        }

        // …and the project really is untouched
        const { rows } = await pool.query(
            'SELECT name, project_data, deleted_at FROM projects WHERE id = $1',
            [project.id],
        );
        expect(rows[0].name).toBe(project.name);
        expect(rows[0].deleted_at).toBeNull();
        expect(rows[0].project_data).toEqual({});
    });

    it('leaves no trace: project-get does not bump last_accessed_at', async () => {
        const target = await seedAuthUser(pool, { name: 'Untouched', keepBootstrapWorkspace: true });
        createdUsers.push(target.id);
        const project = await seedProject(pool, { ownerId: target.id, uploadStatus: 'ready' });
        createdProjects.push(project.id);
        await pool.query(
            `UPDATE projects SET last_accessed_at = now() - interval '30 days' WHERE id = $1`,
            [project.id],
        );
        const before = (await pool.query(
            'SELECT last_accessed_at FROM projects WHERE id = $1', [project.id],
        )).rows[0].last_accessed_at;

        const app = testApp();
        const { token } = (await post(
            app,
            '/admin-impersonate',
            await userToken({ sub: 'admin-user-id', email: ADMIN_EMAIL }),
            { userId: target.id },
        )).json() as { token: string };
        expect((await post(app, '/project-get', token, { projectId: project.id })).statusCode).toBe(200);

        const after = (await pool.query(
            'SELECT last_accessed_at FROM projects WHERE id = $1', [project.id],
        )).rows[0].last_accessed_at;
        // A real session WOULD have bumped this — the admin list orders on it
        expect(after).toEqual(before);
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
