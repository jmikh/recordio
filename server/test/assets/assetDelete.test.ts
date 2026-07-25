/**
 * POST /asset-delete — Part 2 Batch 1
 * (plans/fastify-part2-1-assets-rpc-migration.md).
 *
 * e2e against the real local Postgres. Isolation: unique seeded ids +
 * targeted deletes (user_assets has no cascade parent).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { buildApp, type App } from '../../src/app.js';
import { createFakeDeps, type FakeDeps } from '../fakes/index.js';
import { TEST_JWT_SECRET, userToken } from '../helpers/tokens.js';
import {
    createTestPool,
    deleteUserAssets,
    hasTestDb,
    SEEDED_USER_2_ID,
    SEEDED_USER_ID,
    seedUserAsset,
} from '../helpers/db.js';

async function post(app: App, body: unknown, token?: string) {
    return app.inject({
        method: 'POST',
        url: '/asset-delete',
        headers: token ? { authorization: `Bearer ${token}` } : {},
        payload: body as Record<string, unknown>,
    });
}

describe('POST /asset-delete (auth + validation, no db)', () => {
    function validationApp(): { app: App; deps: FakeDeps } {
        const deps = createFakeDeps();
        const app = buildApp(deps, { supabaseJwtSecret: TEST_JWT_SECRET, logLevel: 'silent' });
        return { app, deps };
    }

    it('401 without a token', async () => {
        const { app } = validationApp();
        const res = await post(app, { assetId: 'a-1' });
        expect(res.statusCode).toBe(401);
        expect(res.json()).toEqual({ error: 'Unauthorized' });
    });

    it.each([
        ['missing assetId', {}],
        ['empty assetId', { assetId: '' }],
    ])('schema 400 pre-query: %s', async (_name, body) => {
        const { app } = validationApp();
        const res = await post(app, body, await userToken({ sub: SEEDED_USER_ID }));
        expect(res.statusCode).toBe(400);
    });
});

describe.runIf(hasTestDb())('POST /asset-delete (e2e, real Postgres)', () => {
    let pool: pg.Pool;
    const createdAssets: string[] = [];

    beforeAll(() => {
        pool = createTestPool();
    });
    afterEach(async () => {
        await deleteUserAssets(pool, createdAssets);
        createdAssets.length = 0;
    });
    afterAll(async () => {
        await pool.end();
    });

    function testApp() {
        const deps = createFakeDeps({ db: pool });
        const app = buildApp(deps, { supabaseJwtSecret: TEST_JWT_SECRET, logLevel: 'silent' });
        return { app };
    }

    async function seed(opts: Parameters<typeof seedUserAsset>[1] = {}) {
        const id = await seedUserAsset(pool, opts);
        createdAssets.push(id);
        return id;
    }

    async function assetRow(id: string) {
        const { rows } = await pool.query(
            'SELECT storage_path, is_deleted FROM user_assets WHERE id = $1',
            [id],
        );
        return rows[0] as { storage_path: string; is_deleted: boolean } | undefined;
    }

    it('soft-deletes an owned asset and returns its storage path', async () => {
        const id = await seed();
        const { app } = testApp();
        const res = await post(app, { assetId: id },
            await userToken({ sub: SEEDED_USER_ID }));

        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({
            storagePath: `${SEEDED_USER_ID}/assets/${id}.bin`,
        });
        expect((await assetRow(id))!.is_deleted).toBe(true);
    });

    it('returns null and leaves the row untouched when the caller does not own it', async () => {
        const id = await seed({ userId: SEEDED_USER_ID });
        const { app } = testApp();
        const res = await post(app, { assetId: id },
            await userToken({ sub: SEEDED_USER_2_ID }));

        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ storagePath: null });
        expect((await assetRow(id))!.is_deleted).toBe(false);
    });

    it('returns null for an unknown asset id', async () => {
        const { app } = testApp();
        const res = await post(app, { assetId: 'no-such-asset' },
            await userToken({ sub: SEEDED_USER_ID }));
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ storagePath: null });
    });
});
