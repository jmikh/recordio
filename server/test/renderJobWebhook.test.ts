/**
 * POST /render-job-webhook — e2e against the real local Postgres
 * (exercises the SHARED `render_job_complete` DB function over the
 * pool); fakeMux + fakeS3 for the completed→Mux upload path.
 *
 * First non-JWT route: the worker's `RENDER_SECRET` bearer, checked
 * BEFORE schema validation (edge-fn check order).
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
    seedRenderJob,
} from './helpers/db.js';

const TEST_SUPABASE_URL = 'http://127.0.0.1:54321';
const TEST_PUBLIC_URL = 'http://127.0.0.1:8090';
const TEST_RENDER_SECRET = 'test-render-secret';

async function post(app: App, payload: unknown, secret?: string) {
    return app.inject({
        method: 'POST',
        url: '/render-job-webhook',
        headers: secret ? { authorization: `Bearer ${secret}` } : {},
        payload: payload as Record<string, unknown>,
    });
}

function build(deps: FakeDeps) {
    return buildApp(deps, {
        supabaseJwtSecret: TEST_JWT_SECRET,
        supabaseUrl: TEST_SUPABASE_URL,
        publicUrl: TEST_PUBLIC_URL,
        renderSecret: TEST_RENDER_SECRET,
        logLevel: 'silent',
    });
}

describe('POST /render-job-webhook (auth + validation, no db)', () => {
    // Throwing-db deps prove every reject path exits before any query
    it('401 without a secret — even with a garbage body (auth precedes validation)', async () => {
        const app = build(createFakeDeps());
        const res = await post(app, { nonsense: true });
        expect(res.statusCode).toBe(401);
        expect(res.json()).toEqual({ error: 'Unauthorized' });
    });

    it('401 with the wrong secret', async () => {
        const app = build(createFakeDeps());
        const res = await post(app, { jobId: 'j-1' }, 'wrong-secret');
        expect(res.statusCode).toBe(401);
        expect(res.json()).toEqual({ error: 'Unauthorized' });
    });

    it.each([
        ['missing jobId', {}],
        ['empty jobId', { jobId: '' }],
    ])('schema 400: %s', async (_name, payload) => {
        const app = build(createFakeDeps());
        const res = await post(app, payload, TEST_RENDER_SECRET);
        expect(res.statusCode).toBe(400);
    });
});

describe.runIf(hasTestDb())('POST /render-job-webhook (e2e, real Postgres)', () => {
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

    function testApp(): { app: App; deps: FakeDeps } {
        const deps = createFakeDeps({ db: pool });
        return { app: build(deps), deps };
    }

    async function seed() {
        const project = await seedProject(pool, {});
        createdProjects.push(project.id);
        return project;
    }

    interface JobRow {
        status: string;
        progress: number | null;
        error: string | null;
        start_duration_s: number | null;
        total_duration_s: number | null;
        download_duration_s: number | null;
        render_duration_s: number | null;
        upload_duration_s: number | null;
    }

    async function jobRow(id: string): Promise<JobRow> {
        const { rows } = await pool.query('SELECT * FROM render_jobs WHERE id = $1', [id]);
        return rows[0] as JobRow;
    }

    it('404 with the exact body for an unknown job', async () => {
        const { app } = testApp();
        const res = await post(
            app,
            { jobId: '00000000-0000-0000-0000-000000000000' },
            TEST_RENDER_SECRET,
        );
        expect(res.statusCode).toBe(404);
        expect(res.json()).toEqual({ error: 'Job not found' });
    });

    it('heartbeat: progress + durations persisted; start_duration_s computed once, never overwritten', async () => {
        const { app, deps } = testApp();
        const project = await seed();
        const jobId = await seedRenderJob(pool, { projectId: project.id, cloudVersion: 1 });

        const first = await post(
            app,
            { jobId, progress: 0.25, download_duration_s: 3.5 },
            TEST_RENDER_SECRET,
        );
        expect(first.statusCode).toBe(200);
        expect(first.json()).toEqual({ ok: true, cancel: false });

        const afterFirst = await jobRow(jobId);
        expect(afterFirst.progress).toBe(0.25);
        expect(afterFirst.download_duration_s).toBe(3.5);
        expect(afterFirst.start_duration_s).not.toBeNull();
        const startDuration = afterFirst.start_duration_s;

        // Advance the fake clock — a recompute would change the value
        deps.clock.advance(60_000);
        await post(app, { jobId, progress: 0.5 }, TEST_RENDER_SECRET);

        const afterSecond = await jobRow(jobId);
        expect(afterSecond.progress).toBe(0.5);
        expect(afterSecond.start_duration_s).toBe(startDuration);
        expect(afterSecond.status).toBe('pending');
    });

    it.each(['completed', 'failed', 'canceled'] as const)(
        'non-pending job (%s): { ok, cancel: true } and the row untouched',
        async (status) => {
            const { app } = testApp();
            const project = await seed();
            const jobId = await seedRenderJob(pool, {
                projectId: project.id,
                cloudVersion: 1,
                status,
            });

            const res = await post(app, { jobId, progress: 0.9 }, TEST_RENDER_SECRET);
            expect(res.statusCode).toBe(200);
            expect(res.json()).toEqual({ ok: true, cancel: true });

            const row = await jobRow(jobId);
            expect(row.status).toBe(status);
            expect(row.progress).toBeNull();
        },
    );

    it('completed without a pending mux_video: job completed, totals stamped, no mux/S3 calls', async () => {
        const { app, deps } = testApp();
        const project = await seed();
        const jobId = await seedRenderJob(pool, { projectId: project.id, cloudVersion: 1 });

        const res = await post(
            app,
            { jobId, status: 'completed', render_duration_s: 12, upload_duration_s: 2 },
            TEST_RENDER_SECRET,
        );
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ ok: true, cancel: false });

        const row = await jobRow(jobId);
        expect(row.status).toBe('completed');
        expect(row.progress).toBe(1);
        expect(row.total_duration_s).not.toBeNull();
        expect(row.render_duration_s).toBe(12);
        expect(row.upload_duration_s).toBe(2);
        expect(deps.mux.createdAssets).toHaveLength(0);
        expect(deps.s3.presignedDownloads).toHaveLength(0);
    });

    it('completed WITH a pending mux_video: uploads to Mux from the presigned render URL, mux row stays pending', async () => {
        const { app, deps } = testApp();
        const project = await seed();
        const renderPath = `u/${project.id}/renders/v2.mp4`;
        const jobId = await seedRenderJob(pool, {
            projectId: project.id,
            cloudVersion: 2,
            renderStoragePath: renderPath,
        });
        const muxVideoId = await seedMuxVideo(pool, {
            projectId: project.id,
            cloudVersion: 2,
            status: 'pending',
        });

        const res = await post(app, { jobId, status: 'completed' }, TEST_RENDER_SECRET);
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ ok: true, cancel: false });

        expect((await jobRow(jobId)).status).toBe('completed');
        expect(deps.s3.presignedDownloads).toEqual([
            { key: renderPath, expiresInSeconds: 3600 },
        ]);
        expect(deps.mux.createdAssets).toEqual([
            { assetId: 'fake-mux-asset-1', inputUrl: `https://fake-s3/get/${renderPath}` },
        ]);
        const { rows } = await pool.query('SELECT * FROM mux_videos WHERE id = $1', [muxVideoId]);
        expect(rows[0]).toMatchObject({
            status: 'pending', // the Mux webhook (Wave D #16) completes it
            mux_asset_id: 'fake-mux-asset-1',
            render_storage_path: renderPath,
        });
    });

    it('completed with a FAILING mux upload: still 200, mux row failed, job still completed', async () => {
        const { app, deps } = testApp();
        deps.mux.createAsset = async () => {
            throw new Error('mux down');
        };
        const project = await seed();
        const jobId = await seedRenderJob(pool, {
            projectId: project.id,
            cloudVersion: 1,
            renderStoragePath: `u/${project.id}/renders/v1.mp4`,
        });
        const muxVideoId = await seedMuxVideo(pool, {
            projectId: project.id,
            cloudVersion: 1,
            status: 'pending',
        });

        const res = await post(app, { jobId, status: 'completed' }, TEST_RENDER_SECRET);
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ ok: true, cancel: false });

        expect((await jobRow(jobId)).status).toBe('completed');
        const { rows } = await pool.query('SELECT * FROM mux_videos WHERE id = $1', [muxVideoId]);
        expect(rows[0]).toMatchObject({ status: 'failed', error: 'Mux API request failed' });
    });

    it('failed: job failed with the error AND the pending mux_video cascades (RPC behavior)', async () => {
        const { app } = testApp();
        const project = await seed();
        const jobId = await seedRenderJob(pool, { projectId: project.id, cloudVersion: 1 });
        const muxVideoId = await seedMuxVideo(pool, {
            projectId: project.id,
            cloudVersion: 1,
            status: 'pending',
        });

        const res = await post(
            app,
            { jobId, status: 'failed', error: 'ffmpeg exploded' },
            TEST_RENDER_SECRET,
        );
        expect(res.statusCode).toBe(200);

        const row = await jobRow(jobId);
        expect(row).toMatchObject({ status: 'failed', error: 'ffmpeg exploded' });
        const { rows } = await pool.query('SELECT * FROM mux_videos WHERE id = $1', [muxVideoId]);
        expect(rows[0]).toMatchObject({ status: 'failed', error: 'ffmpeg exploded' });
    });

    it('failed without an error message: mux cascade uses the RPC default', async () => {
        const { app } = testApp();
        const project = await seed();
        const jobId = await seedRenderJob(pool, { projectId: project.id, cloudVersion: 1 });
        const muxVideoId = await seedMuxVideo(pool, {
            projectId: project.id,
            cloudVersion: 1,
            status: 'pending',
        });

        await post(app, { jobId, status: 'failed' }, TEST_RENDER_SECRET);

        const { rows } = await pool.query('SELECT * FROM mux_videos WHERE id = $1', [muxVideoId]);
        expect(rows[0]).toMatchObject({ status: 'failed', error: 'Render failed' });
    });

    it('contributes render.job_id/project.id and emits render_job.completed', async () => {
        const lines: Record<string, unknown>[] = [];
        const deps = createFakeDeps({ db: pool });
        const app = buildApp(deps, {
            supabaseJwtSecret: TEST_JWT_SECRET,
            supabaseUrl: TEST_SUPABASE_URL,
            publicUrl: TEST_PUBLIC_URL,
            renderSecret: TEST_RENDER_SECRET,
            logStream: {
                write(chunk: string) {
                    for (const line of chunk.split('\n')) {
                        if (line.trim()) lines.push(JSON.parse(line));
                    }
                },
            },
        });
        const project = await seed();
        const jobId = await seedRenderJob(pool, { projectId: project.id, cloudVersion: 1 });

        const res = await post(app, { jobId, status: 'completed' }, TEST_RENDER_SECRET);
        expect(res.statusCode).toBe(200);

        expect(lines.find((l) => l.msg === 'request')).toMatchObject({
            'http.route': '/render-job-webhook',
            'http.response.status_code': 200,
            'render.job_id': jobId,
            'project.id': project.id,
        });
        expect(lines.find((l) => l.event === 'render_job.completed')).toMatchObject({
            'render.job_id': jobId,
            'project.id': project.id,
        });
    });
});
