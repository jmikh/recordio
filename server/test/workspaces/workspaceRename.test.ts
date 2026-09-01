/**
 * POST /workspace-rename — Part 2 Batch 3.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { buildApp, type App } from '../../src/app.js';
import { createFakeDeps } from '../fakes/index.js';
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
        url: '/workspace-rename',
        headers: token ? { authorization: `Bearer ${token}` } : {},
        payload: body as Record<string, unknown>,
    });
}

describe('POST /workspace-rename (auth + validation, no db)', () => {
    function validationApp() {
        return buildApp(createFakeDeps(), { supabaseJwtSecret: TEST_JWT_SECRET, logLevel: 'silent' });
    }

    it('401 without a token', async () => {
        const res = await post(validationApp(), { workspaceId: 'x', name: 'N' });
        expect(res.statusCode).toBe(401);
    });

    it('schema 400 pre-query: missing name', async () => {
        const res = await post(validationApp(), { workspaceId: 'x' }, await userToken());
        expect(res.statusCode).toBe(400);
    });
});

describe.runIf(hasTestDb())('POST /workspace-rename (e2e, real Postgres)', () => {
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
        return buildApp(createFakeDeps({ db: pool }), {
            supabaseJwtSecret: TEST_JWT_SECRET,
            logLevel: 'silent',
        });
    }

    it('403 for a non-admin member; name untouched', async () => {
        const ws = await seedWorkspace(pool, { name: 'Before' });
        createdWorkspaces.push(ws.id);
        await seedWorkspaceMember(pool, { workspaceId: ws.id, userId: SEEDED_USER_2_ID, role: 'creator' });

        const res = await post(testApp(), { workspaceId: ws.id, name: 'After' },
            await userToken({ sub: SEEDED_USER_2_ID }));
        expect(res.statusCode).toBe(403);

        const { rows } = await pool.query('SELECT name FROM workspaces WHERE id = $1', [ws.id]);
        expect(rows[0]).toEqual({ name: 'Before' });
    });

    it('renames for an admin and returns the updated blob', async () => {
        const ws = await seedWorkspace(pool, { name: 'Before' }); // owner (implicit admin): SEEDED_USER_ID
        createdWorkspaces.push(ws.id);

        const res = await post(testApp(), { workspaceId: ws.id, name: 'After' },
            await userToken({ sub: SEEDED_USER_ID }));
        expect(res.statusCode).toBe(200);
        expect(res.json()).toMatchObject({ id: ws.id, name: 'After', owner_id: SEEDED_USER_ID });

        const { rows } = await pool.query('SELECT name FROM workspaces WHERE id = $1', [ws.id]);
        expect(rows[0]).toEqual({ name: 'After' });
    });
});
