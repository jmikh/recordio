/**
 * POST /shared-screenshot-get — e2e against the real local Postgres
 * (plans/screenshots Step 2; sibling of sharedVideoGet.test.ts). The
 * public page only ever gets a presigned URL of the FLATTENED RENDER —
 * the source path must never be presigned.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { buildApp, type App } from '../src/app.js';
import { createFakeDeps, type FakeDeps } from './fakes/index.js';
import { TEST_JWT_SECRET, userToken } from './helpers/tokens.js';
import {
    createTestPool,
    deleteScreenshots,
    deleteWorkspaces,
    hasTestDb,
    seedScreenshot,
    seedWorkspace,
    seedWorkspaceMember,
    SEEDED_USER_2_ID,
    SEEDED_USER_ID,
} from './helpers/db.js';

async function post(app: App, body: unknown, token?: string) {
    return app.inject({
        method: 'POST',
        url: '/shared-screenshot-get',
        headers: token ? { authorization: `Bearer ${token}` } : {},
        payload: body as Record<string, unknown>,
    });
}

describe('POST /shared-screenshot-get (validation, no db)', () => {
    function validationApp(): App {
        return buildApp(createFakeDeps(), { supabaseJwtSecret: TEST_JWT_SECRET, logLevel: 'silent' });
    }

    it('400 when slug is missing or empty', async () => {
        expect((await post(validationApp(), {})).statusCode).toBe(400);
        expect((await post(validationApp(), { slug: '' })).statusCode).toBe(400);
    });

    it('429 above the per-route rate limit', async () => {
        const app = validationApp();
        for (let i = 0; i < 60; i++) {
            expect((await post(app, { slug: '' })).statusCode).toBe(400);
        }
        expect((await post(app, { slug: '' })).statusCode).toBe(429);
    });
});

describe.runIf(hasTestDb())('POST /shared-screenshot-get (e2e, real Postgres)', () => {
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

    it('404 not_found for an unknown slug and for a soft-deleted screenshot', async () => {
        const { app } = testApp();
        expect((await post(app, { slug: 'no-such-slug' })).json()).toEqual({ error: 'not_found' });
        const gone = await seed({ sharePolicy: 'public', deletedAt: new Date().toISOString() });
        expect((await post(app, { slug: gone.slug })).statusCode).toBe(404);
    });

    it.each(['private', 'workspace'] as const)('403 auth_required for an ANONYMOUS viewer when share_policy is %s', async (sharePolicy) => {
        const { app } = testApp();
        const s = await seed({ sharePolicy });
        const res = await post(app, { slug: s.slug });
        expect(res.statusCode).toBe(403);
        expect(res.json()).toEqual({ error: 'auth_required' });
    });

    it('public + published: anonymous gets the owner name, dims, and a presigned URL of the RENDER only', async () => {
        const { app, deps } = testApp();
        const render = `${SEEDED_USER_ID}/screenshots/x/renders/v2.png`;
        const s = await seed({
            name: 'Pricing page', sharePolicy: 'public', widthPx: 1600, heightPx: 3200,
            cloudVersion: 2, renderStoragePath: render, renderCloudVersion: 2,
        });
        deps.supabaseApi.users.set(s.ownerId, { email: 'o@example.com', userMetadata: { full_name: 'Owner Name' } });

        const res = await post(app, { slug: s.slug });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({
            name: 'Pricing page',
            userName: 'Owner Name',
            widthPx: 1600,
            heightPx: 3200,
            imageUrl: `https://fake-s3/get/${render}`,
            stale: false,
        });
        expect(deps.s3.presignedDownloads).toEqual([{ key: render, expiresInSeconds: 3600 }]);
    });

    it('public but never published: imageUrl null, nothing presigned', async () => {
        const { app, deps } = testApp();
        const s = await seed({ sharePolicy: 'public' });
        const res = await post(app, { slug: s.slug });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toMatchObject({ imageUrl: null, stale: false, userName: 'Unknown' });
        expect(deps.s3.presignedDownloads).toEqual([]);
    });

    it('stale: a render from an older cloud_version is still served but flagged', async () => {
        const { app } = testApp();
        const s = await seed({ sharePolicy: 'public', cloudVersion: 3, renderStoragePath: 'r.png', renderCloudVersion: 2 });
        const res = await post(app, { slug: s.slug });
        expect(res.json()).toMatchObject({ imageUrl: 'https://fake-s3/get/r.png', stale: true });
    });

    it('workspace policy: a member can view; a non-member gets 404; the owner always can', async () => {
        const ws = await seedWorkspace(pool, { ownerId: SEEDED_USER_ID });
        createdWorkspaces.push(ws.id);
        const { app } = testApp();
        const s = await seed({ workspaceId: ws.id, sharePolicy: 'workspace' });

        expect((await post(app, { slug: s.slug }, await userToken({ sub: SEEDED_USER_2_ID }))).statusCode).toBe(404);
        await seedWorkspaceMember(pool, { workspaceId: ws.id, userId: SEEDED_USER_2_ID, role: 'viewer' });
        expect((await post(app, { slug: s.slug }, await userToken({ sub: SEEDED_USER_2_ID }))).statusCode).toBe(200);
        expect((await post(app, { slug: s.slug }, await userToken({ sub: SEEDED_USER_ID }))).statusCode).toBe(200);
    });

    it('private: only the owner, even when signed in as a workspace member', async () => {
        const ws = await seedWorkspace(pool, { ownerId: SEEDED_USER_ID });
        createdWorkspaces.push(ws.id);
        await seedWorkspaceMember(pool, { workspaceId: ws.id, userId: SEEDED_USER_2_ID, role: 'admin' });
        const { app } = testApp();
        const s = await seed({ workspaceId: ws.id, sharePolicy: 'private' });
        expect((await post(app, { slug: s.slug }, await userToken({ sub: SEEDED_USER_2_ID }))).statusCode).toBe(404);
        expect((await post(app, { slug: s.slug }, await userToken({ sub: SEEDED_USER_ID }))).statusCode).toBe(200);
    });
});
