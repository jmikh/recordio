/**
 * POST /project-list — Part 2 Batch 2. e2e against real Postgres.
 * Isolation: every test uses its OWN fresh workspace, so exact-array
 * assertions are safe (unlike suites sharing the seeded personal
 * workspaces).
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
    seedProject,
    seedProjectEditor,
    seedWorkspace,
    seedWorkspaceMember,
} from '../helpers/db.js';

async function post(app: App, body: unknown, token?: string) {
    return app.inject({
        method: 'POST',
        url: '/project-list',
        headers: token ? { authorization: `Bearer ${token}` } : {},
        payload: body as Record<string, unknown>,
    });
}

describe('POST /project-list (auth + validation, no db)', () => {
    function validationApp(): { app: App; deps: FakeDeps } {
        const deps = createFakeDeps();
        const app = buildApp(deps, { supabaseJwtSecret: TEST_JWT_SECRET, logLevel: 'silent' });
        return { app, deps };
    }

    it('401 without a token', async () => {
        const { app } = validationApp();
        const res = await post(app, { workspaceId: 'w-1' });
        expect(res.statusCode).toBe(401);
    });

    it('schema 400 pre-query: missing workspaceId', async () => {
        const { app } = validationApp();
        const res = await post(app, {}, await userToken({ sub: SEEDED_USER_ID }));
        expect(res.statusCode).toBe(400);
    });
});

describe.runIf(hasTestDb())('POST /project-list (e2e, real Postgres)', () => {
    let pool: pg.Pool;
    const createdWorkspaces: string[] = [];

    beforeAll(() => {
        pool = createTestPool();
    });
    afterEach(async () => {
        // projects do NOT cascade with their workspace (FK is NO ACTION) —
        // delete them first
        if (createdWorkspaces.length > 0) {
            await pool.query(
                'DELETE FROM projects WHERE workspace_id = ANY($1::uuid[])',
                [createdWorkspaces],
            );
        }
        await deleteWorkspaces(pool, createdWorkspaces);
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

    async function seedOwnWorkspace() {
        const ws = await seedWorkspace(pool, {}); // owner (implicit member): SEEDED_USER_ID
        createdWorkspaces.push(ws.id);
        return ws;
    }

    it('member sees ready projects incl. soft-deleted ones, newest-updated first, summary-shaped', async () => {
        const ws = await seedOwnWorkspace();
        const older = await seedProject(pool, {
            workspaceId: ws.id, uploadStatus: 'ready', updatedAt: '2026-01-01T10:00:00Z' });
        const newer = await seedProject(pool, {
            workspaceId: ws.id, uploadStatus: 'ready', updatedAt: '2026-01-02T10:00:00Z' });
        const softDeleted = await seedProject(pool, {
            workspaceId: ws.id, uploadStatus: 'ready',
            updatedAt: '2026-01-03T10:00:00Z', deletedAt: '2026-01-03T10:00:00Z' });
        await seedProject(pool, { workspaceId: ws.id, uploadStatus: 'pending' });
        await seedProject(pool, {
            workspaceId: ws.id, uploadStatus: 'ready', permanentlyDeleted: true });

        const { app, lines } = testApp();
        const res = await post(app, { workspaceId: ws.id },
            await userToken({ sub: SEEDED_USER_ID }));
        expect(res.statusCode).toBe(200);

        const { projects } = res.json() as { projects: Array<Record<string, unknown>> };
        expect(projects.map((p) => p.id)).toEqual([softDeleted.id, newer.id, older.id]);
        // Summary shape: no project_data; deleted_at present for client filtering
        expect(projects[0].project_data).toBeUndefined();
        expect(projects[0].deleted_at).not.toBeNull();
        expect(projects[1]).toMatchObject({
            id: newer.id,
            name: newer.name,
            owner_id: SEEDED_USER_ID,
            workspace_id: ws.id,
            cloud_version: 1,
            deleted_at: null,
            is_shared: true, // seedProject defaults share_policy 'public'
            workspace_access: 'view',
            is_editor: false, // no project_editors row for the caller
            editor_role: null,
        });

        expect(lines.find((l) => l.msg === 'request')).toMatchObject({
            'http.route': '/project-list',
            'workspace.id': ws.id,
        });
    });

    it('flags is_editor + editor_role on projects shared with the caller via project_editors', async () => {
        const ws = await seedOwnWorkspace();
        await seedWorkspaceMember(pool, { workspaceId: ws.id, userId: SEEDED_USER_2_ID });
        const theirs = await seedProject(pool, {
            workspaceId: ws.id, ownerId: SEEDED_USER_2_ID, uploadStatus: 'ready' });
        const viewOnly = await seedProject(pool, {
            workspaceId: ws.id, ownerId: SEEDED_USER_2_ID, uploadStatus: 'ready' });
        const mine = await seedProject(pool, {
            workspaceId: ws.id, uploadStatus: 'ready' });
        await seedProjectEditor(pool, { projectId: theirs.id, userId: SEEDED_USER_ID });
        await seedProjectEditor(pool, {
            projectId: viewOnly.id, userId: SEEDED_USER_ID, role: 'view' });

        const { app } = testApp();
        const res = await post(app, { workspaceId: ws.id },
            await userToken({ sub: SEEDED_USER_ID }));
        expect(res.statusCode).toBe(200);

        const { projects } = res.json() as { projects: Array<Record<string, unknown>> };
        const byId = new Map(projects.map((p) => [p.id, p]));
        expect(byId.get(theirs.id)).toMatchObject({ is_editor: true, editor_role: 'edit' });
        expect(byId.get(viewOnly.id)).toMatchObject({ is_editor: true, editor_role: 'view' });
        expect(byId.get(mine.id)).toMatchObject({ is_editor: false, editor_role: null });
    });

    it('returns { projects: [] } for an empty workspace', async () => {
        const ws = await seedOwnWorkspace();
        const { app } = testApp();
        const res = await post(app, { workspaceId: ws.id },
            await userToken({ sub: SEEDED_USER_ID }));
        expect(res.json()).toEqual({ projects: [] });
    });

    it('403 with the exact body for a non-member', async () => {
        const ws = await seedOwnWorkspace();
        const { app } = testApp();
        const res = await post(app, { workspaceId: ws.id },
            await userToken({ sub: SEEDED_USER_2_ID }));
        expect(res.statusCode).toBe(403);
        expect(res.json()).toEqual({ error: 'Not a member of this workspace' });
    });

    it('403 when the workspace is soft-deleted (assert_workspace_viewer parity)', async () => {
        const ws = await seedWorkspace(pool, { deletedAt: new Date().toISOString() });
        createdWorkspaces.push(ws.id);
        await seedWorkspaceMember(pool, { workspaceId: ws.id, userId: SEEDED_USER_ID });

        const { app } = testApp();
        const res = await post(app, { workspaceId: ws.id },
            await userToken({ sub: SEEDED_USER_ID }));
        expect(res.statusCode).toBe(403);
    });
});
