/**
 * POST /project-asset-attach — e2e against real Postgres; fakeS3 for the
 * copy. Isolation: unique projects/assets, targeted deletes.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { buildApp, type App } from '../../src/app.js';
import { createFakeDeps, type FakeDeps } from '../fakes/index.js';
import { TEST_JWT_SECRET, userToken } from '../helpers/tokens.js';
import {
    createTestPool,
    deleteProjects,
    deleteUserAssets,
    hasTestDb,
    SEEDED_USER_2_ID,
    SEEDED_USER_ID,
    seedProject,
    seedProjectEditor,
    seedUserAsset,
} from '../helpers/db.js';

async function post(app: App, body: unknown, token?: string) {
    return app.inject({
        method: 'POST',
        url: '/project-asset-attach',
        headers: token ? { authorization: `Bearer ${token}` } : {},
        payload: body as Record<string, unknown>,
    });
}

describe('POST /project-asset-attach (auth + validation, no db)', () => {
    const app = () => buildApp(createFakeDeps(), { supabaseJwtSecret: TEST_JWT_SECRET, logLevel: 'silent' });

    it('401 without a token', async () => {
        expect((await post(app(), { projectId: 'p', assetId: 'a' })).statusCode).toBe(401);
    });

    it('schema 400 pre-query: missing assetId', async () => {
        const res = await post(app(), { projectId: 'p' }, await userToken({ sub: SEEDED_USER_ID }));
        expect(res.statusCode).toBe(400);
    });
});

describe.runIf(hasTestDb())('POST /project-asset-attach (e2e, real Postgres)', () => {
    let pool: pg.Pool;
    const createdProjects: string[] = [];
    const createdAssets: string[] = [];

    beforeAll(() => {
        pool = createTestPool();
    });
    afterEach(async () => {
        await deleteProjects(pool, createdProjects);
        await deleteUserAssets(pool, createdAssets);
        createdProjects.length = 0;
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

    async function project(opts: Parameters<typeof seedProject>[1] = {}) {
        const p = await seedProject(pool, opts);
        createdProjects.push(p.id);
        return p;
    }

    /** A library asset with its object present in the fake bucket. */
    async function asset(deps: FakeDeps, opts: Parameters<typeof seedUserAsset>[1] = {}) {
        const id = await seedUserAsset(pool, opts);
        createdAssets.push(id);
        const libraryPath = `${opts.userId ?? SEEDED_USER_ID}/assets/${id}.bin`;
        deps.s3.objects.set(libraryPath, { body: new Uint8Array([7]), contentType: 'image/webp' });
        return { id, libraryPath };
    }

    it('copies the caller\'s asset into the project and returns the copy\'s key + a signed URL', async () => {
        const { app, deps } = testApp();
        const p = await project();
        const a = await asset(deps);

        const res = await post(app, { projectId: p.id, assetId: a.id }, await userToken({ sub: SEEDED_USER_ID }));

        expect(res.statusCode).toBe(200);
        const copy = `${SEEDED_USER_ID}/${p.id}/assets/${a.id}.bin`;
        expect(res.json()).toEqual({ storagePath: copy, downloadUrl: `https://fake-s3/get/${copy}` });
        expect(deps.s3.objects.get(copy)?.body).toEqual(new Uint8Array([7]));
        // The library original is untouched
        expect(deps.s3.objects.has(a.libraryPath)).toBe(true);
    });

    it('a collaborator\'s asset lands under the project CREATOR\'s prefix', async () => {
        const { app, deps } = testApp();
        const p = await project();
        await seedProjectEditor(pool, { projectId: p.id, userId: SEEDED_USER_2_ID });
        const a = await asset(deps, { userId: SEEDED_USER_2_ID });

        const res = await post(app, { projectId: p.id, assetId: a.id }, await userToken({ sub: SEEDED_USER_2_ID }));

        expect(res.statusCode).toBe(200);
        expect((res.json() as { storagePath: string }).storagePath).toBe(`${SEEDED_USER_ID}/${p.id}/assets/${a.id}.bin`);
    });

    it('404 when the caller can\'t edit the project; nothing copied', async () => {
        const { app, deps } = testApp();
        const p = await project();
        const a = await asset(deps, { userId: SEEDED_USER_2_ID });

        const res = await post(app, { projectId: p.id, assetId: a.id }, await userToken({ sub: SEEDED_USER_2_ID }));

        expect(res.statusCode).toBe(404);
        expect(res.json()).toEqual({ error: 'Project not found or access denied' });
        expect(deps.s3.objects.size).toBe(1);
    });

    it.each([
        ['someone else\'s', { userId: SEEDED_USER_2_ID }],
        ['a deleted', { isDeleted: true }],
        ['a still-pending', { status: 'pending' as const }],
    ])('404 for %s asset; nothing copied', async (_name, opts) => {
        const { app, deps } = testApp();
        const p = await project();
        const a = await asset(deps, opts);

        const res = await post(app, { projectId: p.id, assetId: a.id }, await userToken({ sub: SEEDED_USER_ID }));

        expect(res.statusCode).toBe(404);
        expect(res.json()).toEqual({ error: 'Asset not found' });
        expect(deps.s3.objects.size).toBe(1);
    });
});
