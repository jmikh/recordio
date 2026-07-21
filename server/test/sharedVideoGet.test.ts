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
import { TEST_JWT_SECRET } from './helpers/tokens.js';
import {
    createTestPool,
    deleteProjects,
    hasTestDb,
    seedMuxVideo,
    seedProject,
    SEEDED_USER_ID,
} from './helpers/db.js';

async function post(app: App, body: unknown) {
    return app.inject({
        method: 'POST',
        url: '/shared-video-get',
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

    beforeAll(() => {
        pool = createTestPool();
    });

    afterEach(async () => {
        await deleteProjects(pool, createdProjects);
        createdProjects.length = 0;
    });
    afterAll(async () => {
        await pool.end();
    });

    /** Fresh app per test — the per-route rate limiter's counter is per instance. */
    function testApp(): { app: App; deps: FakeDeps } {
        const deps = createFakeDeps({ db: pool });
        const app = buildApp(deps, { supabaseJwtSecret: TEST_JWT_SECRET, logLevel: 'silent' });
        return { app, deps: deps as FakeDeps };
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

    it('404 when share_policy is private', async () => {
        const { app } = testApp();
        const project = await seed({ sharePolicy: 'private' });
        const res = await post(app, { slug: project.slug });
        expect(res.statusCode).toBe(404);
        expect(res.json()).toEqual({ error: 'not_found' });
    });

    it('404 when share_policy is null', async () => {
        const { app } = testApp();
        const project = await seed({ sharePolicy: null });
        const res = await post(app, { slug: project.slug });
        expect(res.statusCode).toBe(404);
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

    it('pending wins over failed', async () => {
        const { app, deps } = testApp();
        const project = await seed();
        nameOwner(deps, project.ownerId, { full_name: 'Jane' });
        await seedMuxVideo(pool, { projectId: project.id, cloudVersion: 1, status: 'failed' });
        await seedMuxVideo(pool, { projectId: project.id, cloudVersion: 2, status: 'pending' });

        const res = await post(app, { slug: project.slug });
        expect(res.json()).toMatchObject({ status: 'pending' });
    });

    it('failed only', async () => {
        const { app, deps } = testApp();
        const project = await seed();
        nameOwner(deps, project.ownerId, { full_name: 'Jane' });
        await seedMuxVideo(pool, { projectId: project.id, cloudVersion: 1, status: 'failed' });

        const res = await post(app, { slug: project.slug });
        expect(res.json()).toMatchObject({ status: 'failed' });
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
});
