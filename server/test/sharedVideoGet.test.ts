/**
 * POST /shared-video-get — e2e against the real local `supabase start`
 * Postgres (merge-blocking tier; see plan "Testing strategy"). Only third
 * parties are faked: the db is a real pool, supabaseApi is the in-memory
 * fake (its real adapter has its own integration test).
 *
 * Isolation: unique slugs/ids per test, targeted deletes in afterEach —
 * see test/helpers/db.ts for why truncation is not used.
 *
 * The route is read-only, so the "resulting DB state" assertion is that
 * the rows it read are unchanged.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { buildApp, type App } from '../src/app.js';
import { createFakeDeps, type FakeDeps } from './fakes/index.js';
import { TEST_JWT_SECRET, userToken } from './helpers/tokens.js';
import {
    createTestPool,
    deleteProjects,
    deleteWorkspaces,
    hasTestDb,
    seedMuxVideo,
    seedProject,
    seedRenderJob,
    seedProjectEditor,
    seedWorkspace,
    seedWorkspaceMember,
    SEEDED_USER_2_ID,
    SEEDED_USER_ID,
} from './helpers/db.js';

/** Whatever the worker is told to call back on; only its presence matters here. */
const TEST_PUBLIC_URL = 'http://127.0.0.1:8090';

async function post(app: App, body: unknown, token?: string) {
    return app.inject({
        method: 'POST',
        url: '/shared-video-get',
        headers: token ? { authorization: `Bearer ${token}` } : {},
        payload: body as Record<string, unknown>,
    });
}

describe('POST /shared-video-get (validation, no db)', () => {
    // Throwing-db deps prove schema validation rejects before any query
    function validationApp(): App {
        return buildApp(createFakeDeps(), { supabaseJwtSecret: TEST_JWT_SECRET, logLevel: 'silent' });
    }

    it('400 when slug is missing', async () => {
        const res = await post(validationApp(), {});
        expect(res.statusCode).toBe(400);
    });

    it('400 when slug is empty', async () => {
        const res = await post(validationApp(), { slug: '' });
        expect(res.statusCode).toBe(400);
    });

    it('429 above the per-route rate limit', async () => {
        const app = validationApp();
        for (let i = 0; i < 60; i++) {
            const res = await post(app, { slug: '' });
            expect(res.statusCode).toBe(400);
        }
        const res = await post(app, { slug: '' });
        expect(res.statusCode).toBe(429);
    });
});

describe.runIf(hasTestDb())('POST /shared-video-get (e2e, real Postgres)', () => {
    // Lazy: describe bodies run at collection time even when runIf skips,
    // so the pool must not be created until the suite actually executes.
    let pool: pg.Pool;
    const createdProjects: string[] = [];
    const createdWorkspaces: string[] = [];

    beforeAll(() => {
        pool = createTestPool();
    });

    afterEach(async () => {
        await deleteProjects(pool, createdProjects);
        createdProjects.length = 0;
        await deleteWorkspaces(pool, createdWorkspaces);
        createdWorkspaces.length = 0;
    });
    afterAll(async () => {
        await pool.end();
    });

    /**
     * Fresh app per test — the per-route rate limiter's counter is per
     * instance. publicUrl is required because the route now dispatches
     * renders itself (the worker needs a callback URL).
     */
    function testApp(): { app: App; deps: FakeDeps } {
        const deps = createFakeDeps({ db: pool });
        const app = buildApp(deps, {
            supabaseJwtSecret: TEST_JWT_SECRET,
            publicUrl: TEST_PUBLIC_URL,
            logLevel: 'silent',
        });
        return { app, deps: deps as FakeDeps };
    }

    /** A project whose media is uploaded — the precondition for self-heal. */
    async function seedReady(opts: Parameters<typeof seedProject>[1] = {}) {
        return seed({ ...opts, uploadStatus: 'ready' });
    }

    function hoursAgo(n: number): string {
        return new Date(Date.now() - n * 60 * 60 * 1000).toISOString();
    }

    async function muxRow(projectId: string) {
        const { rows } = await pool.query(
            'SELECT status, attempt, cloud_version FROM mux_videos WHERE project_id = $1',
            [projectId],
        );
        return rows as { status: string; attempt: number; cloud_version: number }[];
    }

    async function renderRow(projectId: string) {
        const { rows } = await pool.query(
            'SELECT status, attempt_count, quality FROM render_jobs WHERE project_id = $1',
            [projectId],
        );
        return rows as { status: string; attempt_count: number; quality: string }[];
    }

    async function seed(opts: Parameters<typeof seedProject>[1] = {}) {
        const project = await seedProject(pool, opts);
        createdProjects.push(project.id);
        return project;
    }

    function nameOwner(deps: FakeDeps, ownerId: string, meta: Record<string, unknown>, email?: string) {
        deps.supabaseApi.users.set(ownerId, { email, userMetadata: meta });
    }

    it('404 with the edge function body for an unknown slug', async () => {
        const { app } = testApp();
        const res = await post(app, { slug: 'no-such-slug' });
        expect(res.statusCode).toBe(404);
        expect(res.json()).toEqual({ error: 'not_found' });
    });

    // ── share-access model: non-public policies need a signed-in viewer ──

    it.each(['private', 'workspace'])(
        '403 auth_required for an ANONYMOUS viewer when share_policy is %s', async (sharePolicy) => {
            const { app } = testApp();
            const project = await seed({ sharePolicy });
            const res = await post(app, { slug: project.slug });
            expect(res.statusCode).toBe(403);
            expect(res.json()).toEqual({ error: 'auth_required' });
        });

    it('workspace policy: a workspace member can view; a non-member gets 404', async () => {
        const ws = await seedWorkspace(pool, { ownerId: SEEDED_USER_ID });
        createdWorkspaces.push(ws.id);
        const { app, deps } = testApp();
        const project = await seed({ workspaceId: ws.id, sharePolicy: 'workspace' });
        nameOwner(deps, project.ownerId, { full_name: 'Owner' });

        // user2 is not (yet) a member of this fresh workspace
        const outsider = await post(app, { slug: project.slug },
            await userToken({ sub: SEEDED_USER_2_ID }));
        expect(outsider.statusCode).toBe(404);
        expect(outsider.json()).toEqual({ error: 'not_found' });

        await seedWorkspaceMember(pool, { workspaceId: ws.id, userId: SEEDED_USER_2_ID });
        const member = await post(app, { slug: project.slug },
            await userToken({ sub: SEEDED_USER_2_ID }));
        expect(member.statusCode).toBe(200);
    });

    it('private policy: owner and individually-granted viewer can view; a plain member gets 404', async () => {
        const ws = await seedWorkspace(pool, { ownerId: SEEDED_USER_ID });
        createdWorkspaces.push(ws.id);
        await seedWorkspaceMember(pool, { workspaceId: ws.id, userId: SEEDED_USER_2_ID });
        const { app, deps } = testApp();
        const project = await seed({ workspaceId: ws.id, sharePolicy: 'private' });
        nameOwner(deps, project.ownerId, { full_name: 'Owner' });

        const owner = await post(app, { slug: project.slug },
            await userToken({ sub: SEEDED_USER_ID }));
        expect(owner.statusCode).toBe(200);

        // Plain workspace membership does NOT see a private video
        const member = await post(app, { slug: project.slug },
            await userToken({ sub: SEEDED_USER_2_ID }));
        expect(member.statusCode).toBe(404);

        // ...until individually granted (view role suffices)
        await seedProjectEditor(pool, {
            projectId: project.id, userId: SEEDED_USER_2_ID, role: 'view' });
        const granted = await post(app, { slug: project.slug },
            await userToken({ sub: SEEDED_USER_2_ID }));
        expect(granted.statusCode).toBe(200);
    });

    it('public policy still serves a signed-in viewer (token is harmless)', async () => {
        const { app, deps } = testApp();
        const project = await seed({ name: 'Public one' });
        nameOwner(deps, project.ownerId, { full_name: 'Owner' });
        const res = await post(app, { slug: project.slug },
            await userToken({ sub: SEEDED_USER_2_ID }));
        expect(res.statusCode).toBe(200);
        expect((res.json() as { name: string }).name).toBe('Public one');
    });

    it('canEdit: true for the owner and an edit-role grant; absent for view-only and anonymous viewers', async () => {
        const ws = await seedWorkspace(pool, { ownerId: SEEDED_USER_ID });
        createdWorkspaces.push(ws.id);
        const { app, deps } = testApp();
        // Public + workspace_access 'view': a plain member can watch but not edit
        const project = await seed({ workspaceId: ws.id, sharePolicy: 'public', workspaceAccess: 'view' });
        nameOwner(deps, project.ownerId, { full_name: 'Owner' });
        await seedWorkspaceMember(pool, { workspaceId: ws.id, userId: SEEDED_USER_2_ID });

        const anon = await post(app, { slug: project.slug });
        expect(anon.statusCode).toBe(200);
        expect(anon.json()).not.toHaveProperty('canEdit');

        const owner = await post(app, { slug: project.slug }, await userToken({ sub: SEEDED_USER_ID }));
        expect(owner.json()).toMatchObject({ canEdit: true });

        const member = await post(app, { slug: project.slug }, await userToken({ sub: SEEDED_USER_2_ID }));
        expect(member.statusCode).toBe(200);
        expect(member.json()).not.toHaveProperty('canEdit');

        await seedProjectEditor(pool, { projectId: project.id, userId: SEEDED_USER_2_ID, role: 'edit' });
        const granted = await post(app, { slug: project.slug }, await userToken({ sub: SEEDED_USER_2_ID }));
        expect(granted.json()).toMatchObject({ canEdit: true });
    });

    it('canEdit does not depend on the Mux status (a pending publish is still editable)', async () => {
        const { app, deps } = testApp();
        const project = await seed();
        nameOwner(deps, project.ownerId, { full_name: 'Owner' });
        await seedMuxVideo(pool, { projectId: project.id, cloudVersion: 1, status: 'pending' });

        const res = await post(app, { slug: project.slug }, await userToken({ sub: SEEDED_USER_ID }));
        expect(res.json()).toMatchObject({ status: 'pending', canEdit: true });
    });

    it('404 when the project is soft-deleted', async () => {
        const { app } = testApp();
        const project = await seed({ deletedAt: new Date().toISOString() });
        const res = await post(app, { slug: project.slug });
        expect(res.statusCode).toBe(404);
    });

    it('no mux video: project info only, no status/muxPlaybackId keys', async () => {
        const { app, deps } = testApp();
        const project = await seed({ name: 'My demo' });
        nameOwner(deps, project.ownerId, { full_name: 'Jane Doe' });

        const res = await post(app, { slug: project.slug });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ name: 'My demo', userName: 'Jane Doe' });
    });

    it('completed: returns the playback id of the highest cloud_version completed row', async () => {
        const { app, deps } = testApp();
        const project = await seed();
        nameOwner(deps, project.ownerId, { full_name: 'Jane' });
        // Since the soft-delete removal (2026-07-22) an older completed row
        // legally coexists with a newer one until the daily purge sweeps
        // it — the NEWEST completed version must win (the route orders by
        // cloud_version DESC)
        await seedMuxVideo(pool, { projectId: project.id, cloudVersion: 1, status: 'completed', muxPlaybackId: 'pb-old' });
        await seedMuxVideo(pool, { projectId: project.id, cloudVersion: 2, status: 'completed', muxPlaybackId: 'pb-new' });

        const res = await post(app, { slug: project.slug });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toMatchObject({ status: 'completed', muxPlaybackId: 'pb-new' });
    });

    // ── captions (watch-page transcript) ──────────────────────────

    /** A one-window project with two caption lines, one straddling a cut. */
    const CAPTIONED_PROJECT = {
        timeline: {
            // [0,5000] kept, [5000,8000] cut, [8000,10000] kept at 2x
            outputWindows: [
                { id: 'a', startMs: 0, endMs: 5000, speed: 1 },
                { id: 'b', startMs: 8000, endMs: 10000, speed: 2 },
            ],
            captionSegments: [
                {
                    id: 's1', sourceStartTimeMs: 1000, sourceEndTimeMs: 2000,
                    outputStartTimeMs: 0, outputEndTimeMs: 0, visible: true,
                    words: [
                        { id: 'w1', word: 'um', hidden: true, sourceStartTimeMs: 1000, sourceEndTimeMs: 1200, outputStartTimeMs: 0, outputEndTimeMs: 0, visible: true },
                        { id: 'w2', word: 'hello', sourceStartTimeMs: 1200, sourceEndTimeMs: 2000, outputStartTimeMs: 0, outputEndTimeMs: 0, visible: true },
                    ],
                },
                {
                    id: 's2', sourceStartTimeMs: 6000, sourceEndTimeMs: 7000,
                    outputStartTimeMs: 0, outputEndTimeMs: 0, visible: true,
                    words: [{ id: 'w3', word: 'cut', sourceStartTimeMs: 6000, sourceEndTimeMs: 7000, outputStartTimeMs: 0, outputEndTimeMs: 0, visible: true }],
                },
                {
                    id: 's3', sourceStartTimeMs: 8000, sourceEndTimeMs: 9000,
                    outputStartTimeMs: 0, outputEndTimeMs: 0, visible: true,
                    words: [{ id: 'w4', word: 'fast', sourceStartTimeMs: 8000, sourceEndTimeMs: 9000, outputStartTimeMs: 0, outputEndTimeMs: 0, visible: true }],
                },
            ],
        },
    };

    it('completed: returns the timeline captions as output-time transcript lines', async () => {
        const { app, deps } = testApp();
        const project = await seed({ projectData: CAPTIONED_PROJECT });
        nameOwner(deps, project.ownerId, { full_name: 'Jane' });
        await seedMuxVideo(pool, { projectId: project.id, cloudVersion: 1, status: 'completed', muxPlaybackId: 'pb-1' });

        const res = await post(app, { slug: project.slug });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({
            name: project.name,
            userName: 'Jane',
            status: 'completed',
            muxPlaybackId: 'pb-1',
            captions: [
                { text: 'hello', startMs: 1000, endMs: 2000 },
                { text: 'fast', startMs: 5000, endMs: 5500 },
            ],
        });
    });

    it('completed without captions in the timeline: no captions key', async () => {
        const { app, deps } = testApp();
        const project = await seed({ projectData: { timeline: { outputWindows: [{ id: 'a', startMs: 0, endMs: 1000, speed: 1 }], captionSegments: [] } } });
        nameOwner(deps, project.ownerId, { full_name: 'Jane' });
        await seedMuxVideo(pool, { projectId: project.id, cloudVersion: 1, status: 'completed', muxPlaybackId: 'pb-1' });

        const res = await post(app, { slug: project.slug });
        expect(res.json()).toEqual({ name: project.name, userName: 'Jane', status: 'completed', muxPlaybackId: 'pb-1' });
    });

    it('captions are only sent with a completed video (pending has nothing to seek)', async () => {
        const { app, deps } = testApp();
        const project = await seed({ projectData: CAPTIONED_PROJECT });
        nameOwner(deps, project.ownerId, { full_name: 'Jane' });
        await seedMuxVideo(pool, { projectId: project.id, cloudVersion: 1, status: 'pending' });

        const res = await post(app, { slug: project.slug });
        expect(res.json()).toEqual({ name: project.name, userName: 'Jane', status: 'pending' });
    });

    it('a share link stays live after the workspace trial ends (revamp Step 3: existing links survive; only creating/updating is gated)', async () => {
        const { app, deps } = testApp();
        // Expired trial + spent extension: the free-est a never-pro
        // workspace can get. The route must not consult entitlements.
        const ws = await seedWorkspace(pool, {
            ownerId: SEEDED_USER_ID,
            trialEndsAt: '2020-01-01T00:00:00Z',
            trialExtensionCount: 1,
        });
        createdWorkspaces.push(ws.id);
        const project = await seed({ workspaceId: ws.id, sharePolicy: 'public' });
        nameOwner(deps, project.ownerId, { full_name: 'Jane' });
        await seedMuxVideo(pool, { projectId: project.id, cloudVersion: 1, status: 'completed', muxPlaybackId: 'pb-1' });

        const res = await post(app, { slug: project.slug });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toMatchObject({ status: 'completed', muxPlaybackId: 'pb-1' });
    });

    it('completed wins over a newer pending (edge-function priority)', async () => {
        const { app, deps } = testApp();
        const project = await seed();
        nameOwner(deps, project.ownerId, { full_name: 'Jane' });
        await seedMuxVideo(pool, { projectId: project.id, cloudVersion: 1, status: 'completed', muxPlaybackId: 'pb-1' });
        await seedMuxVideo(pool, { projectId: project.id, cloudVersion: 2, status: 'pending' });

        const res = await post(app, { slug: project.slug });
        expect(res.json()).toMatchObject({ status: 'completed', muxPlaybackId: 'pb-1' });
    });

    it('a completed row with NULL playback id falls through to pending (edge-function parity)', async () => {
        const { app, deps } = testApp();
        const project = await seed();
        nameOwner(deps, project.ownerId, { full_name: 'Jane' });
        await seedMuxVideo(pool, { projectId: project.id, cloudVersion: 2, status: 'completed', muxPlaybackId: null });
        await seedMuxVideo(pool, { projectId: project.id, cloudVersion: 1, status: 'pending' });

        const res = await post(app, { slug: project.slug });
        expect(res.json()).toMatchObject({ status: 'pending' });
        expect(res.json()).not.toHaveProperty('muxPlaybackId');
    });

    it('pending only', async () => {
        const { app, deps } = testApp();
        const project = await seed();
        nameOwner(deps, project.ownerId, { full_name: 'Jane' });
        await seedMuxVideo(pool, { projectId: project.id, cloudVersion: 1, status: 'pending' });

        const res = await post(app, { slug: project.slug });
        expect(res.json()).toMatchObject({ status: 'pending' });
    });

    // ── render progress on a pending video ────────────────────────

    it('pending: carries the 2K render job progress', async () => {
        const { app, deps } = testApp();
        const project = await seed();
        nameOwner(deps, project.ownerId, { full_name: 'Jane' });
        await seedMuxVideo(pool, { projectId: project.id, cloudVersion: 1, status: 'pending' });
        await seedRenderJob(pool, {
            projectId: project.id, cloudVersion: 1, quality: '2K', progress: 0.42,
        });

        const res = await post(app, { slug: project.slug });
        expect(res.json()).toMatchObject({ status: 'pending', progress: 0.42 });
    });

    it('pending: no progress key while the job is queued (progress NULL)', async () => {
        const { app, deps } = testApp();
        const project = await seed();
        nameOwner(deps, project.ownerId, { full_name: 'Jane' });
        await seedMuxVideo(pool, { projectId: project.id, cloudVersion: 1, status: 'pending' });
        await seedRenderJob(pool, { projectId: project.id, cloudVersion: 1, quality: '2K' });

        const res = await post(app, { slug: project.slug });
        expect(res.json()).not.toHaveProperty('progress');
    });

    it('pending: progress 1 = rendered, waiting on the Mux webhook', async () => {
        const { app, deps } = testApp();
        const project = await seed();
        nameOwner(deps, project.ownerId, { full_name: 'Jane' });
        await seedMuxVideo(pool, { projectId: project.id, cloudVersion: 1, status: 'pending' });
        await seedRenderJob(pool, {
            projectId: project.id, cloudVersion: 1, quality: '2K',
            status: 'completed', progress: 1,
        });

        const res = await post(app, { slug: project.slug });
        expect(res.json()).toMatchObject({ status: 'pending', progress: 1 });
    });

    it('pending: a 1080p download render is NOT the source of progress', async () => {
        const { app, deps } = testApp();
        const project = await seed();
        nameOwner(deps, project.ownerId, { full_name: 'Jane' });
        await seedMuxVideo(pool, { projectId: project.id, cloudVersion: 1, status: 'pending' });
        await seedRenderJob(pool, {
            projectId: project.id, cloudVersion: 1, quality: '1080p', progress: 0.9,
        });

        const res = await post(app, { slug: project.slug });
        expect(res.json()).not.toHaveProperty('progress');
    });

    it('pending wins over failed', async () => {
        const { app, deps } = testApp();
        const project = await seed();
        nameOwner(deps, project.ownerId, { full_name: 'Jane' });
        await seedMuxVideo(pool, { projectId: project.id, cloudVersion: 1, status: 'failed' });
        await seedMuxVideo(pool, { projectId: project.id, cloudVersion: 2, status: 'pending' });

        const res = await post(app, { slug: project.slug });
        expect(res.json()).toMatchObject({ status: 'pending' });
    });

    it('failed only, media not uploaded: no status and no dispatch', async () => {
        const { app, deps } = testApp();
        // seedProject defaults upload_status 'pending' — a render would
        // only fail, so the route leaves it alone
        const project = await seed();
        nameOwner(deps, project.ownerId, { full_name: 'Jane' });
        await seedMuxVideo(pool, { projectId: project.id, cloudVersion: 1, status: 'failed' });

        const res = await post(app, { slug: project.slug });
        expect(res.json()).toEqual({ name: 'Test project', userName: 'Jane' });
        expect(deps.renderWorker.submissions).toHaveLength(0);
    });

    it('canceled rows are ignored (edge-function parity)', async () => {
        const { app, deps } = testApp();
        const project = await seed({ name: 'Canceled only' });
        nameOwner(deps, project.ownerId, { full_name: 'Jane' });
        await seedMuxVideo(pool, { projectId: project.id, cloudVersion: 1, status: 'canceled' });

        const res = await post(app, { slug: project.slug });
        expect(res.json()).toEqual({ name: 'Canceled only', userName: 'Jane' });
    });

    it('userName fallbacks: full_name → name → email → Unknown', async () => {
        const project = await seed();

        const cases: Array<{ meta: Record<string, unknown>; email?: string; expected: string }> = [
            { meta: { full_name: 'Full Name', name: 'Short' }, email: 'a@b.c', expected: 'Full Name' },
            { meta: { name: 'Short' }, email: 'a@b.c', expected: 'Short' },
            { meta: {}, email: 'a@b.c', expected: 'a@b.c' },
        ];
        for (const c of cases) {
            const { app, deps } = testApp();
            nameOwner(deps, project.ownerId, c.meta, c.email);
            const res = await post(app, { slug: project.slug });
            expect(res.json().userName).toBe(c.expected);
        }

        // Owner missing from auth entirely
        const { app } = testApp();
        const res = await post(app, { slug: project.slug });
        expect(res.json().userName).toBe('Unknown');
    });

    it('a supabaseApi failure degrades to Unknown and tags the canonical event', async () => {
        const lines: Record<string, unknown>[] = [];
        const deps = createFakeDeps({ db: pool });
        deps.supabaseApi.getUserById = async () => {
            throw new Error('gotrue down');
        };
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
        const project = await seed();

        const res = await post(app, { slug: project.slug });
        expect(res.statusCode).toBe(200);
        expect(res.json().userName).toBe('Unknown');
        expect(lines.find((l) => l.msg === 'request')).toMatchObject({
            error_type: 'SupabaseApiUnavailable',
        });
    });

    it('contributes project.slug / project.id / mux.video_status to the canonical event', async () => {
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
        const project = await seed();
        await seedMuxVideo(pool, { projectId: project.id, cloudVersion: 1, status: 'pending' });

        await post(app, { slug: project.slug });
        expect(lines.find((l) => l.msg === 'request')).toMatchObject({
            'http.route': '/shared-video-get',
            'http.response.status_code': 200,
            'project.slug': project.slug,
            'project.id': project.id,
            'mux.video_status': 'pending',
        });
    });

    it('is read-only: project and mux rows are unchanged by the request', async () => {
        const { app, deps } = testApp();
        const project = await seed();
        nameOwner(deps, project.ownerId, { full_name: 'Jane' });
        await seedMuxVideo(pool, { projectId: project.id, cloudVersion: 1, status: 'completed', muxPlaybackId: 'pb-1' });

        const before = await pool.query(
            'SELECT p.updated_at, m.updated_at AS mux_updated_at, m.status FROM projects p JOIN mux_videos m ON m.project_id = p.id WHERE p.id = $1',
            [project.id],
        );
        await post(app, { slug: project.slug });
        const after = await pool.query(
            'SELECT p.updated_at, m.updated_at AS mux_updated_at, m.status FROM projects p JOIN mux_videos m ON m.project_id = p.id WHERE p.id = $1',
            [project.id],
        );
        expect(after.rows).toEqual(before.rows);
    });

    it('seeded user id sanity: FK target exists', async () => {
        const { rows } = await pool.query('SELECT id FROM auth.users WHERE id = $1', [SEEDED_USER_ID]);
        expect(rows).toHaveLength(1);
    });

    // ── self-heal: the page starts its own render ─────────────────

    it('no mux video: dispatches a 2K render at the project current version', async () => {
        const { app, deps } = testApp();
        const project = await seedReady({ name: 'My demo', cloudVersion: 3 });
        nameOwner(deps, project.ownerId, { full_name: 'Jane Doe' });

        const res = await post(app, { slug: project.slug });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ name: 'My demo', userName: 'Jane Doe', status: 'pending' });

        expect(deps.renderWorker.submissions).toHaveLength(1);
        expect(await muxRow(project.id)).toEqual([
            { status: 'pending', attempt: 1, cloud_version: 3 },
        ]);
        expect(await renderRow(project.id)).toEqual([
            { status: 'pending', attempt_count: 1, quality: '2K' },
        ]);
    });

    it('an ANONYMOUS viewer of a public link triggers the render', async () => {
        const { app, deps } = testApp();
        const project = await seedReady({ sharePolicy: 'public' });
        nameOwner(deps, project.ownerId, { full_name: 'Jane' });

        // No authorization header at all
        const res = await post(app, { slug: project.slug });
        expect(res.json()).toMatchObject({ status: 'pending' });
        expect(deps.renderWorker.submissions).toHaveLength(1);
    });

    it('the dispatch is attributed to the project OWNER, not the viewer', async () => {
        const { app, deps } = testApp();
        const project = await seedReady({ ownerId: SEEDED_USER_ID });
        nameOwner(deps, project.ownerId, { full_name: 'Jane' });

        // A different signed-in viewer with view access via the public policy
        await post(app, { slug: project.slug }, await userToken({ sub: SEEDED_USER_2_ID }));

        const { rows } = await pool.query(
            'SELECT user_id, render_storage_path FROM render_jobs WHERE project_id = $1',
            [project.id],
        );
        expect(rows[0]).toMatchObject({ user_id: SEEDED_USER_ID });
        expect((rows[0] as { render_storage_path: string }).render_storage_path)
            .toBe(`${SEEDED_USER_ID}/${project.id}/renders/v1_2K.mp4`);
    });

    it('a second poll does not dispatch again — the pending row latches it', async () => {
        const { app, deps } = testApp();
        const project = await seedReady();
        nameOwner(deps, project.ownerId, { full_name: 'Jane' });

        await post(app, { slug: project.slug });
        await post(app, { slug: project.slug });
        await post(app, { slug: project.slug });

        expect(deps.renderWorker.submissions).toHaveLength(1);
    });

    it('an older completed video still plays and does NOT render the newer version', async () => {
        const { app, deps } = testApp();
        const project = await seedReady({ cloudVersion: 2 });
        nameOwner(deps, project.ownerId, { full_name: 'Jane' });
        await seedMuxVideo(pool, { projectId: project.id, cloudVersion: 1, status: 'completed', muxPlaybackId: 'pb-old' });

        const res = await post(app, { slug: project.slug });
        expect(res.json()).toMatchObject({ status: 'completed', muxPlaybackId: 'pb-old' });
        expect(deps.renderWorker.submissions).toHaveLength(0);
    });

    it('a completed row without a playback id reads as pending, not a re-render', async () => {
        const { app, deps } = testApp();
        const project = await seedReady();
        nameOwner(deps, project.ownerId, { full_name: 'Jane' });
        await seedMuxVideo(pool, { projectId: project.id, cloudVersion: 1, status: 'completed', muxPlaybackId: null });

        const res = await post(app, { slug: project.slug });
        expect(res.json()).toMatchObject({ status: 'pending' });
        expect(deps.renderWorker.submissions).toHaveLength(0);
    });

    // ── the attempt budget ────────────────────────────────────────

    it('failed, render attempts left: re-dispatches and spends one of each', async () => {
        const { app, deps } = testApp();
        const project = await seedReady();
        nameOwner(deps, project.ownerId, { full_name: 'Jane' });
        await seedMuxVideo(pool, { projectId: project.id, cloudVersion: 1, status: 'failed', attempt: 3 });
        await seedRenderJob(pool, {
            projectId: project.id, cloudVersion: 1, quality: '2K',
            status: 'failed', attemptCount: 3,
        });

        const res = await post(app, { slug: project.slug });
        expect(res.json()).toMatchObject({ status: 'pending' });
        expect(deps.renderWorker.submissions).toHaveLength(1);
        expect(await muxRow(project.id)).toEqual([
            { status: 'pending', attempt: 4, cloud_version: 1 },
        ]);
        expect(await renderRow(project.id)).toEqual([
            { status: 'pending', attempt_count: 4, quality: '2K' },
        ]);
    });

    it('render budget spent inside the cooldown: failed, no dispatch, row untouched', async () => {
        const { app, deps } = testApp();
        const project = await seedReady();
        nameOwner(deps, project.ownerId, { full_name: 'Jane' });
        await seedMuxVideo(pool, { projectId: project.id, cloudVersion: 1, status: 'failed', attempt: 5 });
        await seedRenderJob(pool, {
            projectId: project.id, cloudVersion: 1, quality: '2K',
            status: 'failed', attemptCount: 5,
        });

        const res = await post(app, { slug: project.slug });
        expect(res.json()).toMatchObject({ status: 'failed' });
        expect(deps.renderWorker.submissions).toHaveLength(0);
        // Critically: NOT flipped back to pending, which would strand the
        // page on "Preparing video..." forever
        expect(await muxRow(project.id)).toEqual([
            { status: 'failed', attempt: 5, cloud_version: 1 },
        ]);
    });

    it('budget spent: sends the render error as failureReason outside production', async () => {
        const { app, deps } = testApp();
        const project = await seedReady();
        nameOwner(deps, project.ownerId, { full_name: 'Jane' });
        await seedMuxVideo(pool, {
            projectId: project.id, cloudVersion: 1, status: 'failed',
            attempt: 5, error: 'Render failed',
        });
        await seedRenderJob(pool, {
            projectId: project.id, cloudVersion: 1, quality: '2K',
            status: 'failed', attemptCount: 5, error: 'Worker unresponsive',
        });

        const res = await post(app, { slug: project.slug });
        // The render's own error, not the mux row's cascade of it
        expect(res.json().failureReason).toContain('Worker unresponsive');
    });

    it('production withholds failureReason entirely', async () => {
        const deps = createFakeDeps({ db: pool });
        const app = buildApp(deps, {
            supabaseJwtSecret: TEST_JWT_SECRET,
            publicUrl: TEST_PUBLIC_URL,
            env: 'production',
            logLevel: 'silent',
        });
        const project = await seedReady();
        await seedMuxVideo(pool, {
            projectId: project.id, cloudVersion: 1, status: 'failed',
            attempt: 5, error: 'Mux API error: 401',
        });
        await seedRenderJob(pool, {
            projectId: project.id, cloudVersion: 1, quality: '2K',
            status: 'failed', attemptCount: 5, error: 'Worker unresponsive',
        });

        const res = await post(app, { slug: project.slug });
        expect(res.json()).toMatchObject({ status: 'failed' });
        expect(res.json()).not.toHaveProperty('failureReason');
    });

    it('a dispatch failure reports the thrown message as failureReason', async () => {
        const { app, deps } = testApp();
        const project = await seedReady();
        nameOwner(deps, project.ownerId, { full_name: 'Jane' });
        deps.s3.presignUpload = async () => { throw new Error('s3 down'); };

        const res = await post(app, { slug: project.slug });
        expect(res.json().failureReason).toContain('s3 down');
    });

    it('render budget spent but the cooldown has passed: one more dispatch', async () => {
        const { app, deps } = testApp();
        const project = await seedReady();
        nameOwner(deps, project.ownerId, { full_name: 'Jane' });
        await seedMuxVideo(pool, {
            projectId: project.id, cloudVersion: 1, status: 'failed',
            attempt: 5, updatedAt: hoursAgo(2),
        });
        await seedRenderJob(pool, {
            projectId: project.id, cloudVersion: 1, quality: '2K',
            status: 'failed', attemptCount: 5, updatedAt: hoursAgo(2),
        });

        const res = await post(app, { slug: project.slug });
        expect(res.json()).toMatchObject({ status: 'pending' });
        expect(deps.renderWorker.submissions).toHaveLength(1);
    });

    it('Mux-errored path: the mux counter blocks even with the render cached', async () => {
        const { app, deps } = testApp();
        const project = await seedReady();
        nameOwner(deps, project.ownerId, { full_name: 'Jane' });
        // asset.errored failed the mux row while the render stayed
        // completed — attempt_count is frozen at 1, so only mux.attempt
        // can stop the re-upload loop
        await seedMuxVideo(pool, { projectId: project.id, cloudVersion: 1, status: 'failed', attempt: 5 });
        await seedRenderJob(pool, {
            projectId: project.id, cloudVersion: 1, quality: '2K',
            status: 'completed', attemptCount: 1, progress: 1,
        });

        const res = await post(app, { slug: project.slug });
        expect(res.json()).toMatchObject({ status: 'failed' });
        expect(deps.mux.createdAssets).toHaveLength(0);
    });

    it('a failed publish at an OLDER version does not spend the new version budget', async () => {
        const { app, deps } = testApp();
        const project = await seedReady({ cloudVersion: 2 });
        nameOwner(deps, project.ownerId, { full_name: 'Jane' });
        await seedMuxVideo(pool, { projectId: project.id, cloudVersion: 1, status: 'failed', attempt: 5 });

        const res = await post(app, { slug: project.slug });
        expect(res.json()).toMatchObject({ status: 'pending' });
        expect(deps.renderWorker.submissions).toHaveLength(1);
    });

    it('a dispatch failure answers 200 failed, not 500', async () => {
        const { app, deps } = testApp();
        const project = await seedReady();
        nameOwner(deps, project.ownerId, { full_name: 'Jane' });
        deps.s3.presignUpload = async () => { throw new Error('s3 down'); };

        const res = await post(app, { slug: project.slug });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toMatchObject({ status: 'failed' });
        // The publish service marked the row before rethrowing
        expect(await muxRow(project.id)).toEqual([
            { status: 'failed', attempt: 1, cloud_version: 1 },
        ]);
    });

    it('tags the canonical event when it self-heals', async () => {
        const lines: Record<string, unknown>[] = [];
        const deps = createFakeDeps({ db: pool });
        const app = buildApp(deps, {
            supabaseJwtSecret: TEST_JWT_SECRET,
            publicUrl: TEST_PUBLIC_URL,
            logStream: {
                write(chunk: string) {
                    for (const line of chunk.split('\n')) {
                        if (line.trim()) lines.push(JSON.parse(line));
                    }
                },
            },
        });
        const project = await seedReady();

        await post(app, { slug: project.slug });
        expect(lines.find((l) => l.msg === 'request')).toMatchObject({
            'mux.video_status': 'pending',
            'mux.auto_started': true,
            'mux.attempt': 1,
            'render.attempt_count': 1,
        });
    });
});
