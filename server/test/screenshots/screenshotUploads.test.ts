/**
 * The two multipart screenshot routes — /screenshot-update-thumbnail and
 * /screenshot-render-upload — e2e against the real local Postgres with
 * fakeS3 (plans/screenshots Step 2). Payloads built with Node's FormData
 * and serialized via `new Response(form)` like projectUpdateThumbnail.test.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { buildApp, type App } from '../../src/app.js';
import { createFakeDeps, type FakeDeps } from '../fakes/index.js';
import { TEST_JWT_SECRET, userToken } from '../helpers/tokens.js';
import {
    createTestPool,
    deleteScreenshots,
    deleteWorkspaces,
    hasTestDb,
    SEEDED_USER_2_ID,
    SEEDED_USER_ID,
    seedScreenshot,
    seedWorkspace,
    seedWorkspaceMember,
} from '../helpers/db.js';
import { MAX_RENDER_BYTES } from '../../src/routes/screenshots/screenshotRenderUpload.js';

const owner = () => userToken({ sub: SEEDED_USER_ID });
const other = () => userToken({ sub: SEEDED_USER_2_ID });

async function multipart(form: FormData) {
    const res = new Response(form);
    return {
        payload: Buffer.from(await res.arrayBuffer()),
        contentType: res.headers.get('content-type')!,
    };
}

function form(fields: Record<string, string | undefined>, file?: { bytes: Buffer; type: string; name: string }) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) {
        if (v !== undefined) fd.append(k, v);
    }
    if (file) fd.append('file', new Blob([new Uint8Array(file.bytes)], { type: file.type }), file.name);
    return fd;
}

const WEBP = { bytes: Buffer.from('RIFF....WEBPVP8 fake'), type: 'image/webp', name: 't.webp' };
const PNG = { bytes: Buffer.from('\x89PNG fake-render'), type: 'image/png', name: 'r.png' };

async function post(app: App, url: string, fd: FormData, token?: string) {
    const { payload, contentType } = await multipart(fd);
    return app.inject({
        method: 'POST',
        url,
        headers: { 'content-type': contentType, ...(token ? { authorization: `Bearer ${token}` } : {}) },
        payload,
    });
}

describe('screenshot multipart routes (validation, no db)', () => {
    function validationApp(): { app: App; deps: FakeDeps } {
        const deps = createFakeDeps();
        return { app: buildApp(deps, { supabaseJwtSecret: TEST_JWT_SECRET, logLevel: 'silent' }), deps };
    }

    it('thumbnail: 401 / 400 missing id / 400 missing file / 413 over 500 KB', async () => {
        const { app, deps } = validationApp();
        expect((await post(app, '/screenshot-update-thumbnail', form({ screenshotId: 's' }, WEBP))).statusCode).toBe(401);
        const noId = await post(app, '/screenshot-update-thumbnail', form({}, WEBP), await owner());
        expect(noId.statusCode).toBe(400);
        expect(noId.json()).toEqual({ error: 'Missing screenshotId or file' });
        expect((await post(app, '/screenshot-update-thumbnail', form({ screenshotId: 's' }), await owner())).statusCode).toBe(400);
        const big = await post(app, '/screenshot-update-thumbnail', form({ screenshotId: 's' }, { ...WEBP, bytes: Buffer.alloc(500 * 1024 + 1, 1) }), await owner());
        expect(big.statusCode).toBe(413);
        expect(deps.s3.objects.size).toBe(0);
    });

    it('render: 400 on a missing or non-integer cloudVersion, 413 over the cap', async () => {
        const { app, deps } = validationApp();
        const noVersion = await post(app, '/screenshot-render-upload', form({ screenshotId: 's' }, PNG), await owner());
        expect(noVersion.statusCode).toBe(400);
        expect(noVersion.json()).toEqual({ error: 'Missing screenshotId, cloudVersion or file' });
        expect((await post(app, '/screenshot-render-upload', form({ screenshotId: 's', cloudVersion: '1.5' }, PNG), await owner())).statusCode).toBe(400);
        expect((await post(app, '/screenshot-render-upload', form({ screenshotId: 's', cloudVersion: '0' }, PNG), await owner())).statusCode).toBe(400);
        const big = await post(app, '/screenshot-render-upload', form({ screenshotId: 's', cloudVersion: '1' }, { ...PNG, bytes: Buffer.alloc(MAX_RENDER_BYTES + 1, 1) }), await owner());
        expect(big.statusCode).toBe(413);
        expect(deps.s3.objects.size).toBe(0);
    });
});

describe.runIf(hasTestDb())('screenshot multipart routes (e2e, real Postgres)', () => {
    let pool: pg.Pool;
    const createdScreenshots: string[] = [];
    const createdWorkspaces: string[] = [];

    beforeAll(() => {
        pool = createTestPool();
    });
    afterEach(async () => {
        await deleteScreenshots(pool, createdScreenshots);
        createdScreenshots.length = 0;
        await deleteWorkspaces(pool, createdWorkspaces);
        createdWorkspaces.length = 0;
    });
    afterAll(async () => {
        await pool.end();
    });

    function testApp(): { app: App; deps: FakeDeps } {
        const deps = createFakeDeps({ db: pool });
        return { app: buildApp(deps, { supabaseJwtSecret: TEST_JWT_SECRET, logLevel: 'silent' }), deps };
    }

    async function seed(opts: Parameters<typeof seedScreenshot>[1] = {}) {
        const s = await seedScreenshot(pool, opts);
        createdScreenshots.push(s.id);
        return s;
    }

    async function renderRow(id: string) {
        const { rows } = await pool.query(
            'SELECT render_storage_path AS path, render_cloud_version AS version, thumbnail_storage_path AS thumb FROM screenshots WHERE id = $1',
            [id],
        );
        return rows[0] as { path: string | null; version: number | null; thumb: string | null };
    }

    describe('/screenshot-update-thumbnail', () => {
        it('404 for a non-editor; owner upload lands under the CREATOR prefix and updates the row', async () => {
            const { app, deps } = testApp();
            const s = await seed();
            expect((await post(app, '/screenshot-update-thumbnail', form({ screenshotId: s.id }, WEBP), await other())).statusCode).toBe(404);

            const res = await post(app, '/screenshot-update-thumbnail', form({ screenshotId: s.id }, WEBP), await owner());
            expect(res.statusCode).toBe(200);
            const path = `${SEEDED_USER_ID}/screenshots/${s.id}/thumbnail.webp`;
            expect(res.json()).toEqual({ storagePath: path });
            expect(deps.s3.objects.get(path)?.contentType).toBe('image/webp');
            expect((await renderRow(s.id)).thumb).toBe(path);
        });

        it('a workspace editor (not the creator) still writes under the creator prefix', async () => {
            const ws = await seedWorkspace(pool);
            createdWorkspaces.push(ws.id);
            await seedWorkspaceMember(pool, { workspaceId: ws.id, userId: SEEDED_USER_2_ID, role: 'creator' });
            const s = await seed({ workspaceId: ws.id, sharePolicy: 'workspace', workspaceAccess: 'edit' });
            const { app } = testApp();
            const res = await post(app, '/screenshot-update-thumbnail', form({ screenshotId: s.id }, WEBP), await other());
            expect(res.statusCode).toBe(200);
            expect(res.json()).toEqual({ storagePath: `${SEEDED_USER_ID}/screenshots/${s.id}/thumbnail.webp` });
        });
    });

    describe('/screenshot-render-upload', () => {
        it('404 for a non-editor, nothing stored', async () => {
            const { app, deps } = testApp();
            const s = await seed();
            const res = await post(app, '/screenshot-render-upload', form({ screenshotId: s.id, cloudVersion: '1' }, PNG), await other());
            expect(res.statusCode).toBe(404);
            expect(deps.s3.objects.size).toBe(0);
        });

        it('409 version_mismatch before any put when the client rendered a stale version', async () => {
            const { app, deps } = testApp();
            const s = await seed({ cloudVersion: 3 });
            const res = await post(app, '/screenshot-render-upload', form({ screenshotId: s.id, cloudVersion: '2' }, PNG), await owner());
            expect(res.statusCode).toBe(409);
            expect(res.json()).toEqual({ error: 'version_mismatch' });
            expect(deps.s3.objects.size).toBe(0);
            expect((await renderRow(s.id)).path).toBeNull();
        });

        it('happy path: stores renders/v{n}.png as image/png, points the row at it, deletes the previous render', async () => {
            const { app, deps } = testApp();
            const previous = `${SEEDED_USER_ID}/screenshots/old/renders/v1.png`;
            deps.s3.objects.set(previous, { body: new Uint8Array(1), contentType: 'image/png' });
            const s = await seed({ cloudVersion: 4, renderStoragePath: previous, renderCloudVersion: 1 });

            const res = await post(app, '/screenshot-render-upload', form({ screenshotId: s.id, cloudVersion: '4' }, PNG), await owner());
            expect(res.statusCode).toBe(200);
            const path = `${SEEDED_USER_ID}/screenshots/${s.id}/renders/v4.png`;
            expect(res.json()).toEqual({ storagePath: path, renderCloudVersion: 4 });
            expect(deps.s3.objects.get(path)?.contentType).toBe('image/png');
            expect(Buffer.from(deps.s3.objects.get(path)!.body)).toEqual(PNG.bytes);
            expect(deps.s3.objects.has(previous)).toBe(false);
            expect(deps.s3.deletedKeys).toEqual([previous]);
            expect(await renderRow(s.id)).toMatchObject({ path, version: 4 });
        });

        it('re-publishing the same version overwrites in place without deleting it', async () => {
            const { app, deps } = testApp();
            const s = await seed({ cloudVersion: 2 });
            const path = `${SEEDED_USER_ID}/screenshots/${s.id}/renders/v2.png`;
            await post(app, '/screenshot-render-upload', form({ screenshotId: s.id, cloudVersion: '2' }, PNG), await owner());
            const again = await post(app, '/screenshot-render-upload', form({ screenshotId: s.id, cloudVersion: '2' }, { ...PNG, bytes: Buffer.from('v2 again') }), await owner());
            expect(again.statusCode).toBe(200);
            expect(deps.s3.deletedKeys).toEqual([]);
            expect(Buffer.from(deps.s3.objects.get(path)!.body).toString()).toBe('v2 again');
        });
    });
});
