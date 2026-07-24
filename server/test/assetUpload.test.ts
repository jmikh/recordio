/**
 * POST /asset-upload — e2e against the real local `supabase start`
 * Postgres (merge-blocking tier); fakeS3 for storage. Multipart payloads
 * are built with Node's FormData and serialized via `new Response(form)`
 * (body + boundary header for free), same as projectUpdateThumbnail.
 *
 * Single-request flow: the server uploads the bytes itself and inserts
 * the row directly as 'ready' — no pending state, no presign, no
 * confirm RPC. The library_full-as-200 contract from /asset-create is
 * kept (see the route header).
 *
 * Isolation: unique asset ids (seeded and route-generated), targeted
 * deletes in afterEach — user_assets has no cascade parent.
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

const ownerToken = () => userToken({ sub: SEEDED_USER_ID });

const MB = 1024 * 1024;

/** Serialize a FormData into an inject-able payload + boundary header. */
async function multipart(form: FormData) {
    const res = new Response(form);
    return {
        payload: Buffer.from(await res.arrayBuffer()),
        contentType: res.headers.get('content-type')!,
    };
}

function assetForm(opts: {
    assetType?: string;
    fileName?: string;
    fileBytes?: Buffer;
} = {}) {
    const form = new FormData();
    const assetType = 'assetType' in opts ? opts.assetType : 'background';
    if (assetType !== undefined) form.append('assetType', assetType);
    if (opts.fileBytes !== undefined || !('fileBytes' in opts)) {
        const bytes = opts.fileBytes ?? Buffer.from('fake-image-bytes');
        form.append(
            'file',
            new Blob([new Uint8Array(bytes)]),
            opts.fileName ?? 'photo.jpg',
        );
    }
    return form;
}

async function post(app: App, form: FormData, token?: string) {
    const { payload, contentType } = await multipart(form);
    return app.inject({
        method: 'POST',
        url: '/asset-upload',
        headers: {
            'content-type': contentType,
            ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        payload,
    });
}

describe('POST /asset-upload (auth + validation, no db)', () => {
    // Throwing-db deps prove every reject path exits before any query
    function validationApp(): { app: App; deps: FakeDeps } {
        const deps = createFakeDeps();
        const app = buildApp(deps, { supabaseJwtSecret: TEST_JWT_SECRET, logLevel: 'silent' });
        return { app, deps };
    }

    it('401 without a token', async () => {
        const { app, deps } = validationApp();
        const res = await post(app, assetForm());
        expect(res.statusCode).toBe(401);
        expect(res.json()).toEqual({ error: 'Unauthorized' });
        expect(deps.s3.objects.size).toBe(0);
    });

    it('401 with a garbage token', async () => {
        const { app } = validationApp();
        const res = await post(app, assetForm(), 'not-a-jwt');
        expect(res.statusCode).toBe(401);
        expect(res.json()).toEqual({ error: 'Unauthorized' });
    });

    it.each([
        ['bad assetType', assetForm({ assetType: 'video' })],
        ['missing assetType', assetForm({ assetType: undefined })],
        ['missing file', assetForm({ fileBytes: undefined })],
    ])('400 missing/invalid multipart fields: %s', async (_name, form) => {
        const { app, deps } = validationApp();
        const res = await post(app, form, await ownerToken());
        expect(res.statusCode).toBe(400);
        expect(res.json()).toEqual({ error: 'Missing or invalid assetType or file' });
        expect(deps.s3.objects.size).toBe(0);
    });

    it.each([
        ['background', 'song.mp3', 'jpg, jpeg, png, webp, avif'],
        ['music', 'photo.png', 'mp3, wav, aac, m4a, ogg'],
    ])(
        '400 with the exact edge-fn body for a wrong-type extension (%s)',
        async (assetType, fileName, allowed) => {
            const { app } = validationApp();
            const ext = fileName.split('.').pop();
            const res = await post(app, assetForm({ assetType, fileName }), await ownerToken());
            expect(res.statusCode).toBe(400);
            expect(res.json()).toEqual({
                error: `Invalid file type ".${ext}" for ${assetType}. Allowed: ${allowed}`,
            });
        },
    );

    it('400 for an extensionless file name (empty ext)', async () => {
        const { app } = validationApp();
        const res = await post(app, assetForm({ fileName: 'photo' }), await ownerToken());
        expect(res.statusCode).toBe(400);
        expect(res.json()).toEqual({
            error: 'Invalid file type ".photo" for background. Allowed: jpg, jpeg, png, webp, avif',
        });
    });

    it('400 with the exact edge-fn body one byte over the background cap (actual bytes)', async () => {
        // The cap is now enforced on the uploaded bytes — the old presign
        // flow only ever checked the client-declared sizeBytes
        const { app, deps } = validationApp();
        const res = await post(
            app,
            assetForm({ fileName: 'photo.png', fileBytes: Buffer.alloc(25 * MB + 1) }),
            await ownerToken(),
        );
        expect(res.statusCode).toBe(400);
        expect(res.json()).toEqual({ error: 'File too large. Max 25 MB for background' });
        expect(deps.s3.objects.size).toBe(0);
    });
});

describe.runIf(hasTestDb())('POST /asset-upload (e2e, real Postgres)', () => {
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

    function testApp(db: Db = pool): { app: App; deps: FakeDeps } {
        const deps = createFakeDeps({ db });
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

    it('success: 200 with assetId/storagePath, ready row, bytes in S3 with ext-derived ContentType', async () => {
        const { app, deps } = testApp();
        const fileBytes = Buffer.from('fake-jpeg-bytes-here');
        const res = await post(
            app,
            assetForm({ fileName: 'My Photo.JPEG', fileBytes }),
            await ownerToken(),
        );
        expect(res.statusCode).toBe(200);

        const body = res.json() as { assetId: string; storagePath: string };
        createdAssets.push(body.assetId);

        // Extension comes from the file name, lowercased
        expect(body.storagePath).toBe(`${SEEDED_USER_ID}/assets/${body.assetId}.jpeg`);

        const stored = deps.s3.objects.get(body.storagePath);
        expect(stored).toBeDefined();
        expect(Buffer.from(stored!.body)).toEqual(fileBytes);
        expect(stored!.contentType).toBe('image/jpeg');

        // Inserted directly as ready with the ACTUAL byte size
        const row = await assetRow(body.assetId);
        expect(row).toMatchObject({
            user_id: SEEDED_USER_ID,
            asset_type: 'background',
            storage_path: body.storagePath,
            name: 'My Photo.JPEG',
            size_bytes: String(fileBytes.length),
            status: 'ready',
            is_deleted: false,
        });
    });

    it('library full: 200 with the exact rich body, no insert, no S3 object', async () => {
        const { app, deps } = testApp();
        for (let i = 0; i < 10; i++) await seed({ assetType: 'background' });
        const before = await assetCountFor(SEEDED_USER_ID, 'background');

        const res = await post(app, assetForm(), await ownerToken());
        expect(res.statusCode).toBe(200); // the deliberate fix carried over from /asset-create
        expect(res.json()).toEqual({
            error: 'library_full',
            message: 'Library full (10/10). Delete an asset to upload a new one.',
            count: 10,
            limit: 10,
        });
        expect(deps.s3.objects.size).toBe(0);
        expect(await assetCountFor(SEEDED_USER_ID, 'background')).toBe(before);
    });

    it('soft-deleted and pending rows do not count toward the limit', async () => {
        const { app } = testApp();
        // 8 ready + 1 deleted + 1 pending = 10 rows but only 8 count
        for (let i = 0; i < 8; i++) await seed({ assetType: 'background' });
        await seed({ assetType: 'background', isDeleted: true });
        await seed({ assetType: 'background', status: 'pending' });

        const res = await post(app, assetForm(), await ownerToken());
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
            assetForm({ assetType: 'music', fileName: 'song.mp3' }),
            await ownerToken(),
        );
        expect(music.statusCode).toBe(200);
        const musicBody = music.json() as { assetId?: string; error?: string };
        expect(musicBody.error).toBeUndefined();
        createdAssets.push(musicBody.assetId!);

        // ...while user1's own full background library still rejects
        const background = await post(app, assetForm(), await ownerToken());
        expect(background.statusCode).toBe(200);
        expect((background.json() as { error?: string }).error).toBe('library_full');
    });

    it('insert failure: the uploaded S3 object is deleted before the 500 (compensating cleanup)', async () => {
        const failingDb: Db = {
            query: (text, params) => {
                if (text.includes('INSERT INTO user_assets')) {
                    throw new Error('insert exploded');
                }
                return pool.query(text, params);
            },
        };
        const { app, deps } = testApp(failingDb);
        const before = await assetCountFor(SEEDED_USER_ID, 'background');

        const res = await post(app, assetForm(), await ownerToken());
        expect(res.statusCode).toBe(500);
        expect(deps.s3.objects.size).toBe(0);
        expect(deps.s3.deletedKeys).toHaveLength(1);
        expect(await assetCountFor(SEEDED_USER_ID, 'background')).toBe(before);
    });

    it('contributes asset.type and storage.bytes (actual) to the canonical request event', async () => {
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

        const fileBytes = Buffer.alloc(4096);
        const res = await post(
            app,
            assetForm({ assetType: 'music', fileName: 'song.mp3', fileBytes }),
            await ownerToken(),
        );
        expect(res.statusCode).toBe(200);
        createdAssets.push((res.json() as { assetId: string }).assetId);

        expect(lines.find((l) => l.msg === 'request')).toMatchObject({
            'http.route': '/asset-upload',
            'http.response.status_code': 200,
            'asset.type': 'music',
            'storage.bytes': 4096,
            user_id: SEEDED_USER_ID,
        });
    });
});
