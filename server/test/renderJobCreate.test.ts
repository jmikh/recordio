/**
 * POST /render-job-create — e2e against the real local `supabase start`
 * Postgres (merge-blocking tier); fakeS3 for presigning, fakeRenderWorker
 * for dispatch.
 *
 * First suite exercising a `sql/functions/` DB function over the pool
 * (`render_job_get_or_create`) — the retry test asserts the CURRENT
 * version's attempt_count bump, which the stale baseline-migration copy
 * lacks; CI now runs `supabase/sql/deploy.sh` so both tiers test the SQL
 * production runs. Locally run `supabase/sql/deploy.sh` if it fails.
 *
 * Isolation: unique project ids, targeted deletes (render_jobs and
 * project_editors cascade with their project).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { buildApp, type App } from '../src/app.js';
import { createFakeDeps, type FakeDeps } from './fakes/index.js';
import { TEST_JWT_SECRET, userToken } from './helpers/tokens.js';
import {
    createTestPool,
    deleteProjects,
    hasTestDb,
    SEEDED_USER_2_ID,
    SEEDED_USER_ID,
    seedProject,
    seedProjectEditor,
    seedRenderJob,
} from './helpers/db.js';

const ownerToken = () => userToken({ sub: SEEDED_USER_ID });

const TEST_SUPABASE_URL = 'http://127.0.0.1:54321';
/** Mirrors app.ts: statusCallbackUrl is derived from publicUrl (Wave D cutover). */
const TEST_PUBLIC_URL = 'http://127.0.0.1:8090';
const EXPECTED_CALLBACK = `${TEST_PUBLIC_URL}/render-job-webhook`;

const MEDIA_PROJECT_DATA = {
    screenSource: { storagePath: 'u1/p1/screen.webm' },
    cameraSource: { storagePath: 'u1/p1/camera.webm' },
    microphoneSource: { storagePath: 'u1/p1/mic.wav' },
    settings: {
        background: { storagePath: 'u1/assets/bg.webp' },
        audio: { music: { storagePath: 'u1/assets/song.mp3' } },
    },
};
const ALL_MEDIA_PATHS = [
    'u1/p1/screen.webm',
    'u1/p1/camera.webm',
    'u1/p1/mic.wav',
    'u1/assets/bg.webp',
    'u1/assets/song.mp3',
];

async function post(app: App, payload: unknown, token?: string) {
    return app.inject({
        method: 'POST',
        url: '/render-job-create',
        headers: token ? { authorization: `Bearer ${token}` } : {},
        payload: payload as Record<string, unknown>,
    });
}

describe('POST /render-job-create (auth + validation, no db)', () => {
    // Throwing-db deps prove every reject path exits before any query
    function validationApp(): { app: App; deps: FakeDeps } {
        const deps = createFakeDeps();
        const app = buildApp(deps, {
            supabaseJwtSecret: TEST_JWT_SECRET,
            supabaseUrl: TEST_SUPABASE_URL,
            publicUrl: TEST_PUBLIC_URL,
            logLevel: 'silent',
        });
        return { app, deps };
    }

    it('401 without a token', async () => {
        const { app, deps } = validationApp();
        const res = await post(app, { projectId: 'p-1', cloudVersion: 1 });
        expect(res.statusCode).toBe(401);
        expect(res.json()).toEqual({ error: 'Unauthorized' });
        expect(deps.renderWorker.submissions).toHaveLength(0);
    });

    it('401 with a garbage token', async () => {
        const { app } = validationApp();
        const res = await post(app, { projectId: 'p-1', cloudVersion: 1 }, 'not-a-jwt');
        expect(res.statusCode).toBe(401);
    });

    // Fastify default validation 400s replace the edge fn's `Missing
    // projectId` / `Missing cloudVersion` bodies — documented divergence.
    // cloudVersion must be an INTEGER (the RPC param is INT; the edge fn
    // only checked non-null)
    it.each([
        ['missing projectId', { cloudVersion: 1 }],
        ['empty projectId', { projectId: '', cloudVersion: 1 }],
        ['missing cloudVersion', { projectId: 'p-1' }],
        // null coerces to 0 under Ajv — rejected by the minimum-1 bound
        ['null cloudVersion', { projectId: 'p-1', cloudVersion: null }],
        ['zero cloudVersion', { projectId: 'p-1', cloudVersion: 0 }],
        ['non-integer cloudVersion', { projectId: 'p-1', cloudVersion: 1.5 }],
    ])('schema 400: %s', async (_name, payload) => {
        const { app, deps } = validationApp();
        const res = await post(app, payload, await ownerToken());
        expect(res.statusCode).toBe(400);
        expect(deps.renderWorker.submissions).toHaveLength(0);
    });
});

describe.runIf(hasTestDb())('POST /render-job-create (e2e, real Postgres)', () => {
    // Lazy: describe bodies run at collection time even when runIf skips
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
        const app = buildApp(deps, {
            supabaseJwtSecret: TEST_JWT_SECRET,
            supabaseUrl: TEST_SUPABASE_URL,
            publicUrl: TEST_PUBLIC_URL,
            logLevel: 'silent',
        });
        return { app, deps: deps as FakeDeps };
    }

    async function seed(opts: Parameters<typeof seedProject>[1] = {}) {
        const project = await seedProject(pool, {
            projectData: MEDIA_PROJECT_DATA,
            name: 'Render me',
            ...opts,
        });
        createdProjects.push(project.id);
        return project;
    }

    interface JobRow {
        id: string;
        user_id: string;
        cloud_version: number;
        status: string;
        render_storage_path: string | null;
        attempt_count: number;
    }

    async function jobRows(projectId: string): Promise<JobRow[]> {
        const { rows } = await pool.query(
            'SELECT * FROM render_jobs WHERE project_id = $1 ORDER BY created_at',
            [projectId],
        );
        return rows as JobRow[];
    }

    it('404 with the exact edge-fn body for an unknown project; no job, no dispatch', async () => {
        const { app, deps } = testApp();
        const res = await post(
            app,
            { projectId: '00000000-0000-0000-0000-000000000000', cloudVersion: 1 },
            await ownerToken(),
        );
        expect(res.statusCode).toBe(404);
        expect(res.json()).toEqual({ error: 'Project not found or access denied' });
        expect(deps.renderWorker.submissions).toHaveLength(0);
        expect(deps.s3.presignedDownloads).toHaveLength(0);
    });

    it('404 when the project is soft-deleted', async () => {
        const { app } = testApp();
        const project = await seed({ deletedAt: new Date().toISOString() });
        const res = await post(app, { projectId: project.id, cloudVersion: 1 }, await ownerToken());
        expect(res.statusCode).toBe(404);
    });

    it('404 for an authed user who is neither owner nor editor; DB unchanged', async () => {
        const { app, deps } = testApp();
        const project = await seed({ ownerId: SEEDED_USER_2_ID });

        const res = await post(app, { projectId: project.id, cloudVersion: 1 }, await ownerToken());
        expect(res.statusCode).toBe(404);
        expect(res.json()).toEqual({ error: 'Project not found or access denied' });
        expect(await jobRows(project.id)).toHaveLength(0);
        expect(deps.renderWorker.submissions).toHaveLength(0);
    });

    it('new job: 200 pending, row inserted, media presigned, worker dispatched with full payload', async () => {
        const { app, deps } = testApp();
        const project = await seed();

        const res = await post(app, { projectId: project.id, cloudVersion: 3 }, await ownerToken());
        expect(res.statusCode).toBe(200);

        const expectedPath = `${SEEDED_USER_ID}/${project.id}/renders/v3.mp4`;
        const body = res.json() as { jobId: string; status: string; renderStoragePath: string };
        expect(body.status).toBe('pending');
        expect(body.renderStoragePath).toBe(expectedPath);

        const rows = await jobRows(project.id);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            id: body.jobId,
            user_id: SEEDED_USER_ID,
            cloud_version: 3,
            status: 'pending',
            render_storage_path: expectedPath,
        });

        // All five media kinds presigned for download (1h), output for upload
        expect(deps.s3.presignedDownloads.map((p) => p.key).sort()).toEqual(
            [...ALL_MEDIA_PATHS].sort(),
        );
        expect(deps.s3.presignedDownloads.every((p) => p.expiresInSeconds === 3600)).toBe(true);
        expect(deps.s3.presignedUploads).toEqual([
            { key: expectedPath, expiresInSeconds: 3600 },
        ]);

        expect(deps.renderWorker.submissions).toHaveLength(1);
        const sub = deps.renderWorker.submissions[0];
        expect(sub).toMatchObject({
            jobId: body.jobId,
            projectName: 'Render me',
            quality: '1080p',
            uploadUrl: `https://fake-s3/put/${expectedPath}`,
            statusCallbackUrl: EXPECTED_CALLBACK,
        });
        expect(sub.projectData).toEqual(MEDIA_PROJECT_DATA);
        expect(Object.keys(sub.mediaUrls).sort()).toEqual([...ALL_MEDIA_PATHS].sort());
        expect(sub.mediaUrls['u1/p1/screen.webm']).toBe('https://fake-s3/get/u1/p1/screen.webm');
    });

    it('project with no media in project_data: empty mediaUrls, still dispatches', async () => {
        const { app, deps } = testApp();
        const project = await seed({ projectData: {} });

        const res = await post(app, { projectId: project.id, cloudVersion: 1 }, await ownerToken());
        expect(res.statusCode).toBe(200);
        expect(deps.s3.presignedDownloads).toHaveLength(0);
        expect(deps.renderWorker.submissions[0].mediaUrls).toEqual({});
    });

    it('cache hit: completed job returns its path, no new row, no presigns, no dispatch', async () => {
        const { app, deps } = testApp();
        const project = await seed();
        const jobId = await seedRenderJob(pool, {
            projectId: project.id,
            cloudVersion: 2,
            status: 'completed',
        });

        const res = await post(app, { projectId: project.id, cloudVersion: 2 }, await ownerToken());
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({
            jobId,
            status: 'completed',
            renderStoragePath: `${SEEDED_USER_ID}/${project.id}/renders/v2.mp4`,
        });
        expect(await jobRows(project.id)).toHaveLength(1);
        expect(deps.s3.presignedDownloads).toHaveLength(0);
        expect(deps.s3.presignedUploads).toHaveLength(0);
        expect(deps.renderWorker.submissions).toHaveLength(0);
    });

    it('dedup: an in-flight pending job is returned without a second dispatch', async () => {
        const { app, deps } = testApp();
        const project = await seed();
        const jobId = await seedRenderJob(pool, {
            projectId: project.id,
            cloudVersion: 1,
            status: 'pending',
        });

        const res = await post(app, { projectId: project.id, cloudVersion: 1 }, await ownerToken());
        expect(res.statusCode).toBe(200);
        const body = res.json() as { jobId: string; status: string };
        expect(body.jobId).toBe(jobId);
        expect(body.status).toBe('pending');
        expect(deps.renderWorker.submissions).toHaveLength(0);
        expect(await jobRows(project.id)).toHaveLength(1);
    });

    it('retry: a failed job is reset to pending, attempt_count bumped, and re-dispatched', async () => {
        const { app, deps } = testApp();
        const project = await seed();
        const jobId = await seedRenderJob(pool, {
            projectId: project.id,
            cloudVersion: 1,
            status: 'failed',
        });

        const res = await post(app, { projectId: project.id, cloudVersion: 1 }, await ownerToken());
        expect(res.statusCode).toBe(200);
        const body = res.json() as { jobId: string; status: string };
        expect(body.jobId).toBe(jobId); // row reused, not duplicated
        expect(body.status).toBe('pending');

        const rows = await jobRows(project.id);
        expect(rows).toHaveLength(1);
        // attempt_count bump = the CURRENT sql/functions version (the stale
        // baseline-migration copy resets error instead) — fails if the DB
        // hasn't had supabase/sql/deploy.sh run against it
        expect(rows[0]).toMatchObject({ status: 'pending', attempt_count: 2 });
        expect(deps.renderWorker.submissions).toHaveLength(1);
        expect(deps.renderWorker.submissions[0].jobId).toBe(jobId);
    });

    it('explicit project_editors editor: 200; job and render path land under the EDITOR id (parity)', async () => {
        const { app, deps } = testApp();
        const project = await seed({ ownerId: SEEDED_USER_2_ID });
        await seedProjectEditor(pool, { projectId: project.id, userId: SEEDED_USER_ID });

        const res = await post(app, { projectId: project.id, cloudVersion: 1 }, await ownerToken());
        expect(res.statusCode).toBe(200);
        // Same subtlety as project-update-thumbnail: the RPC gets the
        // CALLER's id, so the output path is namespaced by the editor
        const expectedPath = `${SEEDED_USER_ID}/${project.id}/renders/v1.mp4`;
        expect((res.json() as { renderStoragePath: string }).renderStoragePath).toBe(expectedPath);
        expect((await jobRows(project.id))[0].user_id).toBe(SEEDED_USER_ID);
        expect(deps.renderWorker.submissions).toHaveLength(1);
    });

    it('fire-and-forget: a throwing worker dispatch does not affect the 200 or the job row', async () => {
        const { app, deps } = testApp();
        deps.renderWorker.submitJob = async () => {
            throw new Error('worker down');
        };
        const project = await seed();

        const res = await post(app, { projectId: project.id, cloudVersion: 1 }, await ownerToken());
        expect(res.statusCode).toBe(200);
        expect((res.json() as { status: string }).status).toBe('pending');
        expect((await jobRows(project.id))[0].status).toBe('pending');
    });

    it('contributes project.id and render.job_id to the canonical request event', async () => {
        const lines: Record<string, unknown>[] = [];
        const deps = createFakeDeps({ db: pool });
        const app = buildApp(deps, {
            supabaseJwtSecret: TEST_JWT_SECRET,
            supabaseUrl: TEST_SUPABASE_URL,
            publicUrl: TEST_PUBLIC_URL,
            logStream: {
                write(chunk: string) {
                    for (const line of chunk.split('\n')) {
                        if (line.trim()) lines.push(JSON.parse(line));
                    }
                },
            },
        });
        const project = await seed();

        const res = await post(app, { projectId: project.id, cloudVersion: 1 }, await ownerToken());
        expect(res.statusCode).toBe(200);
        expect(lines.find((l) => l.msg === 'request')).toMatchObject({
            'http.route': '/render-job-create',
            'http.response.status_code': 200,
            'project.id': project.id,
            'render.job_id': (res.json() as { jobId: string }).jobId,
            user_id: SEEDED_USER_ID,
        });
    });
});
