/**
 * POST /asset-create — e2e against the real local `supabase start`
 * Postgres (merge-blocking tier); fakeS3 for presigning.
 *
 * Includes the deliberate library_full fix: 200 with the rich body
 * where the edge fn sent 403 (see the route header comment).
 *
 * Isolation: unique asset ids (seeded and route-generated), targeted
 * deletes in afterEach — user_assets has no cascade parent.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { buildApp, type App } from '../src/app.js';
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

const ownerToken = () => userToken({ sub: SEEDED_USER_ID });

const MB = 1024 * 1024;

function assetBody(overrides: Record<string, unknown> = {}) {
    return {
        assetType: 'background',
        fileName: 'photo.jpg',
        sizeBytes: 1234,
        ...overrides,
    };
}

async function post(app: App, payload: unknown, token?: string) {
    return app.inject({
        method: 'POST',
        url: '/asset-create',
        headers: token ? { authorization: `Bearer ${token}` } : {},
        payload: payload as Record<string, unknown>,
    });
}

describe('POST /asset-create (auth + validation, no db)', () => {
    // Throwing-db deps prove every reject path exits before any query
    function validationApp(): { app: App; deps: FakeDeps } {
        const deps = createFakeDeps();
        const app = buildApp(deps, { supabaseJwtSecret: TEST_JWT_SECRET, logLevel: 'silent' });
        return { app, deps };
    }

    it('401 without a token', async () => {
        const { app, deps } = validationApp();
        const res = await post(app, assetBody());
        expect(res.statusCode).toBe(401);
        expect(res.json()).toEqual({ error: 'Unauthorized' });
        expect(deps.s3.presignedUploads).toHaveLength(0);
    });

    it('401 with a garbage token', async () => {
        const { app } = validationApp();
        const res = await post(app, assetBody(), 'not-a-jwt');
        expect(res.statusCode).toBe(401);
        expect(res.json()).toEqual({ error: 'Unauthorized' });
    });

    // Fastify default validation 400s, not the edge fn's per-field
    // bodies — documented divergence, same as all waves
    it.each([
        ['bad assetType', assetBody({ assetType: 'video' })],
        ['missing assetType', { fileName: 'photo.jpg', sizeBytes: 1 }],
        ['missing fileName', { assetType: 'background', sizeBytes: 1 }],
        ['empty fileName', assetBody({ fileName: '' })],
        ['sizeBytes 0', assetBody({ sizeBytes: 0 })],
        ['sizeBytes negative', assetBody({ sizeBytes: -5 })],
        ['sizeBytes non-numeric string', assetBody({ sizeBytes: 'abc' })],
    ])('schema 400: %s', async (_name, payload) => {
        const { app } = validationApp();
        const res = await post(app, payload, await ownerToken());
        expect(res.statusCode).toBe(400);
    });

    it.each([
        ['background', 'song.mp3', 'jpg, jpeg, png, webp, avif'],
        ['music', 'photo.png', 'mp3, wav, aac, m4a, ogg'],
    ])(
        '400 with the exact edge-fn body for a wrong-type extension (%s)',
        async (assetType, fileName, allowed) => {
            const { app } = validationApp();
            const ext = fileName.split('.').pop();
            const res = await post(app, assetBody({ assetType, fileName }), await ownerToken());
            expect(res.statusCode).toBe(400);
            expect(res.json()).toEqual({
                error: `Invalid file type ".${ext}" for ${assetType}. Allowed: ${allowed}`,
            });
        },
    );

    it('400 for an extensionless file name (empty ext)', async () => {
        const { app } = validationApp();
        const res = await post(app, assetBody({ fileName: 'photo' }), await ownerToken());
        expect(res.statusCode).toBe(400);
        expect(res.json()).toEqual({
            error: 'Invalid file type ".photo" for background. Allowed: jpg, jpeg, png, webp, avif',
        });
    });

    it.each([
        ['background', 'photo.png', 25 * MB, 25],
        ['music', 'song.mp3', 50 * MB, 50],
    ])(
        '400 with the exact edge-fn body one byte over the %s cap',
        async (assetType, fileName, cap, maxMB) => {
            const { app, deps } = validationApp();
            const res = await post(
                app,
                assetBody({ assetType, fileName, sizeBytes: cap + 1 }),
                await ownerToken(),
            );
            expect(res.statusCode).toBe(400);
            expect(res.json()).toEqual({ error: `File too large. Max ${maxMB} MB for ${assetType}` });
            expect(deps.s3.presignedUploads).toHaveLength(0);
        },
    );
});

describe.runIf(hasTestDb())('POST /asset-create (e2e, real Postgres)', () => {
    // Lazy: describe bodies run at collection time even when runIf skips
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

    function testApp(): { app: App; deps: FakeDeps } {
        const deps = createFakeDeps({ db: pool });
        const app = buildApp(deps, { supabaseJwtSecret: TEST_JWT_SECRET, logLevel: 'silent' });
        return { app, deps: deps as FakeDeps };
    }

    async function seed(opts: Parameters<typeof seedUserAsset>[1] = {}) {
        const id = await seedUserAsset(pool, opts);
        createdAssets.push(id);
        return id;
    }

    interface AssetRow {
        id: string;
        user_id: string;
        asset_type: string;
        storage_path: string;
        name: string | null;
        size_bytes: string; // bigint comes back as string
        status: string;
        is_deleted: boolean;
    }

    async function assetRow(id: string): Promise<AssetRow | undefined> {
        const { rows } = await pool.query('SELECT * FROM user_assets WHERE id = $1', [id]);
        return rows[0] as AssetRow | undefined;
    }

    async function assetCountFor(userId: string, assetType: string): Promise<number> {
        const { rows } = await pool.query(
            'SELECT COUNT(*)::int AS count FROM user_assets WHERE user_id = $1 AND asset_type = $2',
            [userId, assetType],
        );
        return (rows[0] as { count: number }).count;
    }

    it('success: 200 with signedUrl/storagePath/assetId, pending row, 1h presign', async () => {
        const { app, deps } = testApp();
        const res = await post(
            app,
            assetBody({ fileName: 'My Photo.JPEG', sizeBytes: 2048 }),
            await ownerToken(),
        );
        expect(res.statusCode).toBe(200);

        const body = res.json() as { signedUrl: string; storagePath: string; assetId: string };
        createdAssets.push(body.assetId);

        // Extension comes from the file name, lowercased
        expect(body.storagePath).toBe(`${SEEDED_USER_ID}/assets/${body.assetId}.jpeg`);
        expect(body.signedUrl).toBe(`https://fake-s3/put/${body.storagePath}`);
        expect(deps.s3.presignedUploads).toEqual([
            { key: body.storagePath, expiresInSeconds: 3600 },
        ]);

        const row = await assetRow(body.assetId);
        expect(row).toMatchObject({
            user_id: SEEDED_USER_ID,
            asset_type: 'background',
            storage_path: body.storagePath,
            name: 'My Photo.JPEG',
            size_bytes: '2048',
            status: 'pending',
            is_deleted: false,
        });
    });

    it('divergence pin: a numeric-string sizeBytes is coerced, not rejected', async () => {
        // Fastify's default Ajv coerces "2048" → 2048 where the edge fn's
        // typeof check 400'd. The client always sends a number; noted in
        // suggested_changes.md
        const { app } = testApp();
        const res = await post(app, assetBody({ sizeBytes: '2048' }), await ownerToken());
        expect(res.statusCode).toBe(200);
        const body = res.json() as { assetId: string };
        createdAssets.push(body.assetId);
        expect((await assetRow(body.assetId))!.size_bytes).toBe('2048');
    });

    it('boundary: exactly at the size cap passes for both types', async () => {
        const { app } = testApp();
        for (const [assetType, fileName, cap] of [
            ['background', 'photo.png', 25 * MB],
            ['music', 'song.mp3', 50 * MB],
        ] as const) {
            const res = await post(
                app,
                assetBody({ assetType, fileName, sizeBytes: cap }),
                await ownerToken(),
            );
            expect(res.statusCode).toBe(200);
            createdAssets.push((res.json() as { assetId: string }).assetId);
        }
    });

    it('library full: 200 with the exact rich body (the deliberate fix) and NO insert', async () => {
        const { app, deps } = testApp();
        for (let i = 0; i < 10; i++) await seed({ assetType: 'background' });
        const before = await assetCountFor(SEEDED_USER_ID, 'background');

        const res = await post(app, assetBody(), await ownerToken());
        expect(res.statusCode).toBe(200); // edge fn sent 403 — see route header
        expect(res.json()).toEqual({
            error: 'library_full',
            message: 'Library full (10/10). Delete an asset to upload a new one.',
            count: 10,
            limit: 10,
        });
        expect(deps.s3.presignedUploads).toHaveLength(0);
        expect(await assetCountFor(SEEDED_USER_ID, 'background')).toBe(before);
    });

    it('soft-deleted and pending rows do not count toward the limit', async () => {
        const { app } = testApp();
        // 8 ready + 1 deleted + 1 pending = 10 rows but only 8 count
        for (let i = 0; i < 8; i++) await seed({ assetType: 'background' });
        await seed({ assetType: 'background', isDeleted: true });
        await seed({ assetType: 'background', status: 'pending' });

        const res = await post(app, assetBody(), await ownerToken());
        expect(res.statusCode).toBe(200);
        const body = res.json() as { assetId?: string; error?: string };
        expect(body.error).toBeUndefined();
        createdAssets.push(body.assetId!);
    });

    it('the limit is per type and per user', async () => {
        const { app } = testApp();
        for (let i = 0; i < 10; i++) await seed({ assetType: 'background' });
        for (let i = 0; i < 10; i++) {
            await seed({ assetType: 'music', userId: SEEDED_USER_2_ID });
        }

        // user1's full BACKGROUND library and user2's full MUSIC library
        // block neither: user1 uploading music succeeds
        const music = await post(
            app,
            assetBody({ assetType: 'music', fileName: 'song.mp3' }),
            await ownerToken(),
        );
        expect(music.statusCode).toBe(200);
        const musicBody = music.json() as { assetId?: string; error?: string };
        expect(musicBody.error).toBeUndefined();
        createdAssets.push(musicBody.assetId!);

        // ...while user1's own full background library still rejects
        const background = await post(app, assetBody(), await ownerToken());
        expect(background.statusCode).toBe(200);
        expect((background.json() as { error?: string }).error).toBe('library_full');
    });

    it('presign failure: pending row is deleted before the 500 (compensating cleanup)', async () => {
        const { app, deps } = testApp();
        deps.s3.presignUpload = async () => {
            throw new Error('presign exploded');
        };
        const before = await assetCountFor(SEEDED_USER_ID, 'background');

        const res = await post(app, assetBody(), await ownerToken());
        expect(res.statusCode).toBe(500);
        expect(await assetCountFor(SEEDED_USER_ID, 'background')).toBe(before);
    });

    it('contributes asset.type and storage.bytes to the canonical request event', async () => {
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

        const res = await post(
            app,
            assetBody({ assetType: 'music', fileName: 'song.mp3', sizeBytes: 4096 }),
            await ownerToken(),
        );
        expect(res.statusCode).toBe(200);
        createdAssets.push((res.json() as { assetId: string }).assetId);

        expect(lines.find((l) => l.msg === 'request')).toMatchObject({
            'http.route': '/asset-create',
            'http.response.status_code': 200,
            'asset.type': 'music',
            'storage.bytes': 4096,
            user_id: SEEDED_USER_ID,
        });
    });
});
