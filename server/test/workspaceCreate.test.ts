/**
 * POST /workspace-create — Part 2 Batch 3.
 * Dedicated auth user: the route mutates default_workspace_id.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { buildApp, type App } from '../src/app.js';
import { createFakeDeps } from './fakes/index.js';
import { TEST_JWT_SECRET, userToken } from './helpers/tokens.js';
import {
    createTestPool,
    deleteAuthUsers,
    deleteWorkspaces,
    getDefaultWorkspaceId,
    hasTestDb,
    seedAuthUser,
    type SeededAuthUser,
} from './helpers/db.js';

async function post(app: App, body: unknown, token?: string) {
    return app.inject({
        method: 'POST',
        url: '/workspace-create',
        headers: token ? { authorization: `Bearer ${token}` } : {},
        payload: body as Record<string, unknown>,
    });
}

describe('POST /workspace-create (auth + validation, no db)', () => {
    function validationApp() {
        return buildApp(createFakeDeps(), { supabaseJwtSecret: TEST_JWT_SECRET, logLevel: 'silent' });
    }

    it('401 without a token', async () => {
        const res = await post(validationApp(), { name: 'W' });
        expect(res.statusCode).toBe(401);
    });

    it.each([
        ['missing name', {}],
        ['empty name', { name: '' }],
    ])('schema 400 pre-query: %s', async (_name, body) => {
        const res = await post(validationApp(), body, await userToken());
        expect(res.statusCode).toBe(400);
    });
});

describe.runIf(hasTestDb())('POST /workspace-create (e2e, real Postgres)', () => {
    let pool: pg.Pool;
    let user: SeededAuthUser;
    const createdWorkspaces: string[] = [];

    beforeAll(async () => {
        pool = createTestPool();
        user = await seedAuthUser(pool);
    });
    afterAll(async () => {
        await deleteWorkspaces(pool, createdWorkspaces);
        await deleteAuthUsers(pool, [user.id]);
        await pool.end();
    });

    function testApp() {
        return buildApp(createFakeDeps({ db: pool }), {
            supabaseJwtSecret: TEST_JWT_SECRET,
            logLevel: 'silent',
        });
    }

    it('creates the workspace + admin membership, sets it as default, returns the blob', async () => {
        const res = await post(testApp(), { name: 'My new space' },
            await userToken({ sub: user.id, email: user.email }));
        expect(res.statusCode).toBe(200);

        const body = res.json() as Record<string, unknown>;
        createdWorkspaces.push(body.id as string);
        expect(body).toMatchObject({
            name: 'My new space',
            owner_id: user.id,
            role: 'admin',
        });
        expect(typeof body.created_at).toBe('string');

        const { rows: memberRows } = await pool.query(
            'SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
            [body.id, user.id],
        );
        expect(memberRows).toEqual([{ role: 'admin' }]);
        expect(await getDefaultWorkspaceId(pool, user.id)).toBe(body.id);
    });
});
