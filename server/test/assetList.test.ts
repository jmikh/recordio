/**
 * POST /asset-list — Part 2 Batch 1
 * (plans/fastify-part2-1-assets-rpc-migration.md).
 *
 * e2e against the real local Postgres; fakeS3 records the downloadUrl
 * presigns.
 *
 * Isolation: assertions are CONTAINMENT-based (this suite's created ids
 * only), never whole-array equality for SEEDED_USER_ID — assetUpload's
 * e2e suite seeds background assets for the same user in parallel.
 * user2/background is uncontested (assetUpload touches user2 music only),
 * so the empty-list case asserts there.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { buildApp, type App } from '../src/app.js';
import type { Db } from '../src/deps.js';
import { createFakeDeps, type FakeDeps } from './fakes/index.js';
import { TEST_JWT_SECRET, userToken } from './helpers/tokens.js';
import {
    createTestPool,
    deleteUserAssets,
    hasTestDb,
    SEEDED_USER_2_ID,
    SEEDED_USER_ID,
    seedUserAsset,
} from './helpers/db.js';

async function post(app: App, body: unknown, token?: string) {
    return app.inject({
        method: 'POST',
        url: '/asset-list',
        headers: token ? { authorization: `Bearer ${token}` } : {},
        payload: body as Record<string, unknown>,
    });
}

describe('POST /asset-list (auth + validation, no db)', () => {
    // Throwing-db deps prove every reject path exits before any query
    function validationApp(): { app: App; deps: FakeDeps } {
        const deps = createFakeDeps();
        const app = buildApp(deps, { supabaseJwtSecret: TEST_JWT_SECRET, logLevel: 'silent' });
        return { app, deps };
    }

    it('401 without a token', async () => {
        const { app } = validationApp();
        const res = await post(app, { assetType: 'background' });
        expect(res.statusCode).toBe(401);
        expect(res.json()).toEqual({ error: 'Unauthorized' });
    });

    it.each([
        ['missing assetType', {}],
        ['invalid assetType', { assetType: 'video' }],
    ])('schema 400 pre-query: %s', async (_name, body) => {
        const { app } = validationApp();
        const res = await post(app, body, await userToken({ sub: SEEDED_USER_ID }));
        expect(res.statusCode).toBe(400);
    });
});

describe.runIf(hasTestDb())('POST /asset-list (e2e, real Postgres)', () => {
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

    function testApp(db: Db = pool) {
        const lines: Record<string, unknown>[] = [];
        const deps = createFakeDeps({ db });
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

    async function seed(opts: Parameters<typeof seedUserAsset>[1] = {}) {
        const id = await seedUserAsset(pool, opts);
        createdAssets.push(id);
        return id;
    }

    it('returns only own+ready+not-deleted rows of the type, newest first, each with a presigned downloadUrl', async () => {
        const older = await seed({ createdAt: '2026-01-01T10:00:00Z' });
        const newer = await seed({ createdAt: '2026-01-02T10:00:00Z' });
        const wrongType = await seed({ assetType: 'music' });
        const deleted = await seed({ isDeleted: true });
        const pending = await seed({ status: 'pending' });
        const otherUser = await seed({ userId: SEEDED_USER_2_ID });

        const { app, deps } = testApp();
        const res = await post(app, { assetType: 'background' },
            await userToken({ sub: SEEDED_USER_ID }));
        expect(res.statusCode).toBe(200);

        const { assets } = res.json() as { assets: Array<Record<string, unknown>> };
        const mine = assets.filter((a) => createdAssets.includes(a.id as string));
        expect(mine.map((a) => a.id)).toEqual([newer, older]);
        for (const excluded of [wrongType, deleted, pending, otherUser]) {
            expect(assets.map((a) => a.id)).not.toContain(excluded);
        }

        expect(mine[1]).toEqual({
            id: older,
            assetType: 'background',
            storagePath: `${SEEDED_USER_ID}/assets/${older}.bin`,
            name: 'seed-asset',
            sizeBytes: 1024,
            createdAt: expect.any(String),
            downloadUrl: `https://fake-s3/get/${SEEDED_USER_ID}/assets/${older}.bin`,
        });

        // Presigned with the fixed 1h expiry, one per returned row
        const presigns = deps.s3.presignedDownloads.filter((p) =>
            [older, newer].some((id) => p.key.includes(id)));
        expect(presigns).toHaveLength(2);
        expect(presigns.every((p) => p.expiresInSeconds === 3600)).toBe(true);
    });

    it('returns an empty list when the user has no assets of the type', async () => {
        const { app } = testApp();
        const res = await post(app, { assetType: 'background' },
            await userToken({ sub: SEEDED_USER_2_ID }));
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ assets: [] });
    });

    it('contributes asset.type / storage.path_count to the canonical event', async () => {
        await seed({ userId: SEEDED_USER_2_ID, assetType: 'music' });
        const { app, lines } = testApp();
        await post(app, { assetType: 'music' },
            await userToken({ sub: SEEDED_USER_2_ID }));

        const event = lines.find((l) => l.msg === 'request');
        expect(event).toMatchObject({
            'http.route': '/asset-list',
            'http.response.status_code': 200,
            'asset.type': 'music',
        });
        // ≥ 1 (parallel suites may add user2 music rows)
        expect(event!['storage.path_count'] as number).toBeGreaterThanOrEqual(1);
    });
});
