/**
 * POST /project-get — Part 2 Batch 2 (fastify-part2-2 prompt).
 * e2e against real Postgres. Isolation: unique projects via seedProject +
 * targeted deletes; own workspaces where workspace state matters.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { buildApp, type App } from '../../src/app.js';
import { createFakeDeps, type FakeDeps } from '../fakes/index.js';
import { TEST_JWT_SECRET, userToken } from '../helpers/tokens.js';
import {
    createTestPool,
    deleteProjects,
    deleteWorkspaces,
    hasTestDb,
    SEEDED_USER_2_ID,
    SEEDED_USER_ID,
    seedProject,
    seedProjectEditor,
    seedWorkspace,
    seedWorkspaceMember,
} from '../helpers/db.js';

async function post(app: App, body: unknown, token?: string) {
    return app.inject({
        method: 'POST',
        url: '/project-get',
        headers: token ? { authorization: `Bearer ${token}` } : {},
        payload: body as Record<string, unknown>,
    });
}

describe('POST /project-get (auth + validation, no db)', () => {
    function validationApp(): { app: App; deps: FakeDeps } {
        const deps = createFakeDeps();
        const app = buildApp(deps, { supabaseJwtSecret: TEST_JWT_SECRET, logLevel: 'silent' });
        return { app, deps };
    }

    it('401 without a token', async () => {
        const { app } = validationApp();
        const res = await post(app, { projectId: 'p-1' });
        expect(res.statusCode).toBe(401);
    });

    it('schema 400 pre-query: missing projectId', async () => {
        const { app } = validationApp();
        const res = await post(app, {}, await userToken({ sub: SEEDED_USER_ID }));
        expect(res.statusCode).toBe(400);
    });
});

describe.runIf(hasTestDb())('POST /project-get (e2e, real Postgres)', () => {
    let pool: pg.Pool;
    const createdProjects: string[] = [];
    const createdWorkspaces: string[] = [];

    beforeAll(() => {
        pool = createTestPool();
    });
    afterEach(async () => {
        await deleteProjects(pool, createdProjects);
        await deleteWorkspaces(pool, createdWorkspaces);
        createdProjects.length = 0;
        createdWorkspaces.length = 0;
    });
    afterAll(async () => {
        await pool.end();
    });

    function testApp() {
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
        return { app, lines };
    }

    async function seed(opts: Parameters<typeof seedProject>[1] = {}) {
        const p = await seedProject(pool, opts);
        createdProjects.push(p.id);
        return p;
    }

    it('returns the full project shape for the owner and bumps last_accessed_at', async () => {
        const project = await seed({ projectData: { tracks: [1, 2] }, slug: null });
        await seedProjectEditor(pool, { projectId: project.id, userId: SEEDED_USER_2_ID });

        const before = await pool.query(
            'SELECT last_accessed_at FROM projects WHERE id = $1', [project.id]);

        const { app, lines } = testApp();
        const res = await post(app, { projectId: project.id },
            await userToken({ sub: SEEDED_USER_ID }));
        expect(res.statusCode).toBe(200);

        const body = res.json() as Record<string, unknown>;
        expect(body).toMatchObject({
            id: project.id,
            name: project.name,
            created_by: SEEDED_USER_ID,
            owner_id: SEEDED_USER_ID,
            project_data: { tracks: [1, 2] },
            cloud_version: 1,
            upload_status: 'pending',
            slug: null,
            is_shared: false,
        });
        // The editors list joins auth.users (email) + user_profiles (name)
        const editors = body.editors as Array<Record<string, unknown>>;
        expect(editors).toHaveLength(1);
        expect(editors[0]).toMatchObject({
            user_id: SEEDED_USER_2_ID,
            email: 'user2@gmail.com',
        });

        const after = await pool.query(
            'SELECT last_accessed_at FROM projects WHERE id = $1', [project.id]);
        expect(after.rows[0].last_accessed_at).not.toEqual(before.rows[0].last_accessed_at);

        expect(lines.find((l) => l.msg === 'request')).toMatchObject({
            'http.route': '/project-get',
            'project.id': project.id,
        });
    });

    it('an explicit project editor has access', async () => {
        const project = await seed();
        await seedProjectEditor(pool, { projectId: project.id, userId: SEEDED_USER_2_ID });

        const { app } = testApp();
        const res = await post(app, { projectId: project.id },
            await userToken({ sub: SEEDED_USER_2_ID }));
        expect(res.statusCode).toBe(200);
    });

    it.each([
        ['another user', async () => (await seedProject(pool, {})).id, SEEDED_USER_2_ID],
        ['a soft-deleted project', async () =>
            (await seedProject(pool, { deletedAt: new Date().toISOString() })).id, SEEDED_USER_ID],
    ])('403 with the exact body for %s', async (_name, seedFn, caller) => {
        const projectId = await seedFn();
        createdProjects.push(projectId);
        const { app } = testApp();
        const res = await post(app, { projectId }, await userToken({ sub: caller }));
        expect(res.statusCode).toBe(403);
        expect(res.json()).toEqual({ error: 'Not an editor of this project' });
    });

    it('403 when the project workspace is soft-deleted (assert_project_editor parity)', async () => {
        const ws = await seedWorkspace(pool, { deletedAt: new Date().toISOString() });
        createdWorkspaces.push(ws.id);
        await seedWorkspaceMember(pool, { workspaceId: ws.id, userId: SEEDED_USER_ID });
        const project = await seed({ workspaceId: ws.id });

        const { app } = testApp();
        const res = await post(app, { projectId: project.id },
            await userToken({ sub: SEEDED_USER_ID }));
        expect(res.statusCode).toBe(403);
        expect(res.json()).toEqual({ error: 'Not an editor of this project' });
    });
});
