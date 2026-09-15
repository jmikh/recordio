/**
 * The JSON screenshot routes end to end against the real local Postgres
 * (plans/screenshots Step 2): get / list / update / rename / delete /
 * restore / confirm-upload / share. One suite because they share the
 * access model (screenshotAccess.ts) — policy-only, no per-user grants.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { buildApp, type App } from '../../src/app.js';
import { createFakeDeps } from '../fakes/index.js';
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

const owner = () => userToken({ sub: SEEDED_USER_ID });
const other = () => userToken({ sub: SEEDED_USER_2_ID });

async function post(app: App, url: string, body: unknown, token?: string) {
    return app.inject({
        method: 'POST',
        url,
        headers: token ? { authorization: `Bearer ${token}` } : {},
        payload: body as Record<string, unknown>,
    });
}

describe('screenshot routes (auth, no db)', () => {
    const app = () => buildApp(createFakeDeps(), { supabaseJwtSecret: TEST_JWT_SECRET, logLevel: 'silent' });

    it.each([
        ['/screenshot-get', { screenshotId: 'x' }],
        ['/screenshot-list', { workspaceId: 'x' }],
        ['/screenshot-update', { screenshotId: 'x', screenshotData: {} }],
        ['/screenshot-rename', { screenshotId: 'x', name: 'n' }],
        ['/screenshot-delete', { screenshotId: 'x' }],
        ['/screenshot-restore', { screenshotId: 'x' }],
        ['/screenshot-confirm-upload', { screenshotId: 'x' }],
        ['/screenshot-share', { screenshotId: 'x', sharePolicy: 'public' }],
    ])('%s → 401 without a token', async (url, body) => {
        const res = await post(app(), url, body);
        expect(res.statusCode).toBe(401);
    });

    it('screenshot-get 400s pre-query with neither id nor slug', async () => {
        const res = await post(app(), '/screenshot-get', {}, await owner());
        expect(res.statusCode).toBe(400);
        expect(res.json()).toEqual({ error: 'screenshotId or slug required' });
    });

    it('screenshot-share 400s on a missing/invalid policy', async () => {
        expect((await post(app(), '/screenshot-share', { screenshotId: 'x' }, await owner())).statusCode).toBe(400);
        expect((await post(app(), '/screenshot-share', { screenshotId: 'x', sharePolicy: 'friends' }, await owner())).statusCode).toBe(400);
    });
});

describe.runIf(hasTestDb())('screenshot routes (e2e, real Postgres)', () => {
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

    const app = () => buildApp(createFakeDeps({ db: pool }), { supabaseJwtSecret: TEST_JWT_SECRET, logLevel: 'silent' });

    async function workspace(opts: Parameters<typeof seedWorkspace>[1] = {}) {
        const ws = await seedWorkspace(pool, opts);
        createdWorkspaces.push(ws.id);
        return ws;
    }

    async function seed(opts: Parameters<typeof seedScreenshot>[1] = {}) {
        const s = await seedScreenshot(pool, opts);
        createdScreenshots.push(s.id);
        return s;
    }

    async function column<T>(id: string, col: string): Promise<T> {
        const { rows } = await pool.query(`SELECT ${col} AS v FROM screenshots WHERE id = $1`, [id]);
        return (rows[0] as { v: T }).v;
    }

    // ── get ──────────────────────────────────────────────────────

    describe('/screenshot-get', () => {
        it('owner: by id and by slug, full row shape, last_accessed_at bumped', async () => {
            const s = await seed({ name: 'Login page', pageTitle: 'Login', renderStoragePath: 'r.png', renderCloudVersion: 1 });
            await pool.query(`UPDATE screenshots SET last_accessed_at = '2000-01-01' WHERE id = $1`, [s.id]);

            const byId = await post(app(), '/screenshot-get', { screenshotId: s.id }, await owner());
            expect(byId.statusCode).toBe(200);
            expect(byId.json()).toMatchObject({
                id: s.id,
                name: 'Login page',
                owner_id: SEEDED_USER_ID,
                created_by: SEEDED_USER_ID,
                workspace_id: s.workspaceId,
                screenshot_data: {},
                source_storage_path: `${SEEDED_USER_ID}/screenshots/${s.id}/source.png`,
                width_px: 1280,
                height_px: 720,
                capture_mode: 'visible',
                page_title: 'Login',
                upload_status: 'ready',
                cloud_version: 1,
                slug: s.slug,
                share_policy: 'private',
                workspace_access: 'view',
                is_shared: false,
                render_storage_path: 'r.png',
                render_cloud_version: 1,
            });
            expect(typeof byId.json().owner_email).toBe('string');

            const bySlug = await post(app(), '/screenshot-get', { slug: s.slug }, await owner());
            expect(bySlug.statusCode).toBe(200);
            expect(bySlug.json().id).toBe(s.id);

            const accessed = await column<Date>(s.id, 'last_accessed_at');
            expect(new Date(accessed).getFullYear()).toBeGreaterThan(2000);
        });

        it('403 for an unknown slug and for a non-member (indistinguishable)', async () => {
            const s = await seed();
            const unknown = await post(app(), '/screenshot-get', { slug: 'nope' }, await owner());
            expect(unknown.statusCode).toBe(403);
            const outsider = await post(app(), '/screenshot-get', { screenshotId: s.id }, await other());
            expect(outsider.statusCode).toBe(403);
            expect(outsider.json()).toEqual({ error: 'Not an editor of this screenshot' });
        });

        it('workspace edit share: creator member can load, viewer member cannot, view-level share cannot', async () => {
            const ws = await workspace();
            const editable = await seed({ workspaceId: ws.id, sharePolicy: 'workspace', workspaceAccess: 'edit' });
            const viewOnly = await seed({ workspaceId: ws.id, sharePolicy: 'public', workspaceAccess: 'view' });

            await seedWorkspaceMember(pool, { workspaceId: ws.id, userId: SEEDED_USER_2_ID, role: 'viewer' });
            expect((await post(app(), '/screenshot-get', { screenshotId: editable.id }, await other())).statusCode).toBe(403);

            await pool.query('UPDATE workspace_members SET role = $3 WHERE workspace_id = $1 AND user_id = $2', [ws.id, SEEDED_USER_2_ID, 'creator']);
            expect((await post(app(), '/screenshot-get', { screenshotId: editable.id }, await other())).statusCode).toBe(200);
            expect((await post(app(), '/screenshot-get', { screenshotId: viewOnly.id }, await other())).statusCode).toBe(403);
        });

        it('a soft-deleted screenshot is gone for everyone (403)', async () => {
            const s = await seed({ deletedAt: new Date().toISOString() });
            expect((await post(app(), '/screenshot-get', { screenshotId: s.id }, await owner())).statusCode).toBe(403);
        });
    });

    // ── list ─────────────────────────────────────────────────────

    describe('/screenshot-list', () => {
        it('member sees ready screenshots incl. soft-deleted ones, newest-updated first; pending and purged hidden', async () => {
            const ws = await workspace();
            const older = await seed({ workspaceId: ws.id, name: 'older', updatedAt: '2026-01-01T00:00:00Z' });
            const newer = await seed({ workspaceId: ws.id, name: 'newer', updatedAt: '2026-02-01T00:00:00Z' });
            const trashed = await seed({ workspaceId: ws.id, name: 'trashed', deletedAt: '2026-03-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z' });
            await seed({ workspaceId: ws.id, name: 'pending', uploadStatus: 'pending' });
            await seed({ workspaceId: ws.id, name: 'purged', permanentlyDeleted: true, deletedAt: '2025-01-01T00:00:00Z' });

            const res = await post(app(), '/screenshot-list', { workspaceId: ws.id }, await owner());
            expect(res.statusCode).toBe(200);
            const list = res.json().screenshots as Array<Record<string, unknown>>;
            expect(list.map((s) => s.id)).toEqual([newer.id, older.id, trashed.id]);
            expect(list[0]).toMatchObject({
                name: 'newer',
                width_px: 1280,
                height_px: 720,
                capture_mode: 'visible',
                slug: newer.slug,
                share_policy: 'private',
                is_shared: false,
                deleted_at: null,
            });
            expect(list[2].deleted_at).not.toBeNull();
            expect('screenshot_data' in list[0]).toBe(false);
        });

        it('403 for a non-member', async () => {
            const ws = await workspace();
            const res = await post(app(), '/screenshot-list', { workspaceId: ws.id }, await other());
            expect(res.statusCode).toBe(403);
        });
    });

    // ── update ───────────────────────────────────────────────────

    describe('/screenshot-update', () => {
        const doc = (n: number) => ({ id: 'd', schemaVersion: 1, annotations: [{ id: `a${n}` }] });

        it('compare-and-set bumps the version; a stale version returns null and writes nothing', async () => {
            const s = await seed({ screenshotData: doc(0) });
            const ok = await post(app(), '/screenshot-update', { screenshotId: s.id, screenshotData: doc(1), expectedVersion: 1 }, await owner());
            expect(ok.statusCode).toBe(200);
            expect(ok.json()).toEqual({ cloudVersion: 2 });

            const stale = await post(app(), '/screenshot-update', { screenshotId: s.id, screenshotData: doc(2), expectedVersion: 1 }, await owner());
            expect(stale.statusCode).toBe(200);
            expect(stale.json()).toEqual({ cloudVersion: null });
            expect(await column(s.id, 'screenshot_data')).toEqual(doc(1));
            expect(await column(s.id, 'cloud_version')).toBe(2);
        });

        it('unchanged data is a no-op: current version returned, updated_at untouched, even with a stale expectedVersion', async () => {
            const s = await seed({ screenshotData: doc(0), cloudVersion: 5, updatedAt: '2026-01-01T00:00:00Z' });
            const res = await post(app(), '/screenshot-update', { screenshotId: s.id, screenshotData: doc(0), expectedVersion: 1 }, await owner());
            expect(res.json()).toEqual({ cloudVersion: 5 });
            expect(new Date(await column<string>(s.id, 'updated_at')).toISOString()).toBe('2026-01-01T00:00:00.000Z');
        });

        it('no expectedVersion: unconditional write, no version bump', async () => {
            const s = await seed({ screenshotData: doc(0), cloudVersion: 3 });
            const res = await post(app(), '/screenshot-update', { screenshotId: s.id, screenshotData: doc(1) }, await owner());
            expect(res.json()).toEqual({ cloudVersion: 3 });
            expect(await column(s.id, 'screenshot_data')).toEqual(doc(1));
        });

        it('403 for a non-editor', async () => {
            const s = await seed();
            const res = await post(app(), '/screenshot-update', { screenshotId: s.id, screenshotData: doc(1) }, await other());
            expect(res.statusCode).toBe(403);
        });
    });

    // ── rename / delete / restore / confirm ──────────────────────

    it('rename: editor renames; non-editor 403', async () => {
        const s = await seed();
        expect((await post(app(), '/screenshot-rename', { screenshotId: s.id, name: 'New' }, await owner())).json()).toEqual({ ok: true });
        expect(await column(s.id, 'name')).toBe('New');
        expect((await post(app(), '/screenshot-rename', { screenshotId: s.id, name: 'Nope' }, await other())).statusCode).toBe(403);
        expect(await column(s.id, 'name')).toBe('New');
    });

    it('delete: owner soft-deletes once; non-owner and repeat are { deleted: false }', async () => {
        const s = await seed();
        expect((await post(app(), '/screenshot-delete', { screenshotId: s.id }, await other())).json()).toEqual({ deleted: false });
        expect((await post(app(), '/screenshot-delete', { screenshotId: s.id }, await owner())).json()).toEqual({ deleted: true });
        expect(await column(s.id, 'deleted_at')).not.toBeNull();
        expect((await post(app(), '/screenshot-delete', { screenshotId: s.id }, await owner())).json()).toEqual({ deleted: false });
    });

    it('restore: free workspace 403 subscription_required; trial workspace restores; purged rows never restore', async () => {
        const free = await workspace();
        const s1 = await seed({ workspaceId: free.id, deletedAt: new Date().toISOString() });
        const gated = await post(app(), '/screenshot-restore', { screenshotId: s1.id }, await owner());
        expect(gated.statusCode).toBe(403);
        expect(gated.json()).toEqual({ error: 'subscription_required' });

        const trial = await workspace({ trialEndsAt: '2100-01-01T00:00:00Z' });
        const s2 = await seed({ workspaceId: trial.id, deletedAt: new Date().toISOString() });
        expect((await post(app(), '/screenshot-restore', { screenshotId: s2.id }, await owner())).json()).toEqual({ restored: true });
        expect(await column(s2.id, 'deleted_at')).toBeNull();

        const s3 = await seed({ workspaceId: trial.id, deletedAt: new Date().toISOString(), permanentlyDeleted: true });
        expect((await post(app(), '/screenshot-restore', { screenshotId: s3.id }, await owner())).json()).toEqual({ restored: false });
    });

    it('confirm-upload: owner flips pending → ready once', async () => {
        const s = await seed({ uploadStatus: 'pending' });
        expect((await post(app(), '/screenshot-confirm-upload', { screenshotId: s.id }, await other())).json()).toEqual({ confirmed: false });
        expect((await post(app(), '/screenshot-confirm-upload', { screenshotId: s.id }, await owner())).json()).toEqual({ confirmed: true });
        expect(await column(s.id, 'upload_status')).toBe('ready');
        expect((await post(app(), '/screenshot-confirm-upload', { screenshotId: s.id }, await owner())).json()).toEqual({ confirmed: false });
    });

    // ── share ────────────────────────────────────────────────────

    describe('/screenshot-share', () => {
        it('owner on a trial workspace can share publicly with edit access; slug returned', async () => {
            const ws = await workspace({ trialEndsAt: '2100-01-01T00:00:00Z' });
            const s = await seed({ workspaceId: ws.id });
            const res = await post(app(), '/screenshot-share', { screenshotId: s.id, sharePolicy: 'public', workspaceAccess: 'edit' }, await owner());
            expect(res.statusCode).toBe(200);
            expect(res.json()).toEqual({ slug: s.slug });
            expect(await column(s.id, 'share_policy')).toBe('public');
            expect(await column(s.id, 'workspace_access')).toBe('edit');
        });

        it('omitted workspaceAccess keeps the current level', async () => {
            const ws = await workspace({ trialEndsAt: '2100-01-01T00:00:00Z' });
            const s = await seed({ workspaceId: ws.id, workspaceAccess: 'edit' });
            await post(app(), '/screenshot-share', { screenshotId: s.id, sharePolicy: 'workspace' }, await owner());
            expect(await column(s.id, 'workspace_access')).toBe('edit');
        });

        it('free workspace: public/workspace → 403 subscription_required, private always allowed', async () => {
            const ws = await workspace();
            const s = await seed({ workspaceId: ws.id, sharePolicy: 'public' });
            const gated = await post(app(), '/screenshot-share', { screenshotId: s.id, sharePolicy: 'workspace' }, await owner());
            expect(gated.statusCode).toBe(403);
            expect(gated.json()).toEqual({ error: 'subscription_required' });
            expect(await column(s.id, 'share_policy')).toBe('public');

            const unshare = await post(app(), '/screenshot-share', { screenshotId: s.id, sharePolicy: 'private' }, await owner());
            expect(unshare.statusCode).toBe(200);
            expect(await column(s.id, 'share_policy')).toBe('private');
        });

        it('owner-only: a workspace editor gets 403; unknown id 404', async () => {
            const ws = await workspace({ trialEndsAt: '2100-01-01T00:00:00Z' });
            await seedWorkspaceMember(pool, { workspaceId: ws.id, userId: SEEDED_USER_2_ID, role: 'creator' });
            const s = await seed({ workspaceId: ws.id, sharePolicy: 'workspace', workspaceAccess: 'edit' });
            const res = await post(app(), '/screenshot-share', { screenshotId: s.id, sharePolicy: 'public' }, await other());
            expect(res.statusCode).toBe(403);
            const missing = await post(app(), '/screenshot-share', { screenshotId: '00000000-0000-0000-0000-000000000000', sharePolicy: 'public' }, await owner());
            expect(missing.statusCode).toBe(404);
        });
    });
});
