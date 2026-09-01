/**
 * POST /mux-video-create — e2e against the real local `supabase start`
 * Postgres (merge-blocking tier); fakeMux for asset creation, fakeS3 for
 * presigning, fakeRenderWorker for dispatch.
 *
 * Exercises `mux_video_get_or_create` over the pool (CI runs
 * `supabase/sql/deploy.sh`; locally run it if the RPC is missing) and the
 * in-process render get-or-create (`services/renderJobs.ts`) that
 * replaced the edge fn's service-role HTTP hop — the renderJobCreate
 * suite passing unchanged is the extraction's refactor guard.
 *
 * Isolation: unique project ids, targeted deletes (mux_videos,
 * render_jobs and project_editors cascade with their project).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { buildApp, type App } from '../src/app.js';
import { MuxApiError } from '../src/ports/mux.js';
import { createFakeDeps, type FakeDeps } from './fakes/index.js';
import { TEST_JWT_SECRET, userToken } from './helpers/tokens.js';
import {
    createTestPool,
    deleteProjects,
    hasTestDb,
    SEEDED_USER_2_ID,
    SEEDED_USER_ID,
    seedMuxVideo,
    deleteAuthUsers,
    deleteWorkspaces,
    seedAuthUser,
    seedProject,
    seedProjectEditor,
    seedSubscription,
    seedWorkspace,
    type SeededAuthUser,
    seedRenderJob,
} from './helpers/db.js';

const ownerToken = () => userToken({ sub: SEEDED_USER_ID });

const TEST_SUPABASE_URL = 'http://127.0.0.1:54321';
/** Mirrors app.ts: statusCallbackUrl is derived from publicUrl (Wave D cutover). */
const TEST_PUBLIC_URL = 'http://127.0.0.1:8090';
const EXPECTED_CALLBACK = `${TEST_PUBLIC_URL}/render-job-webhook`;

async function post(app: App, payload: unknown, token?: string) {
    return app.inject({
        method: 'POST',
        url: '/mux-video-create',
        headers: token ? { authorization: `Bearer ${token}` } : {},
        payload: payload as Record<string, unknown>,
    });
}

describe('POST /mux-video-create (auth + validation, no db)', () => {
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
        expect(deps.mux.createdAssets).toHaveLength(0);
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
        expect(deps.mux.createdAssets).toHaveLength(0);
        expect(deps.renderWorker.submissions).toHaveLength(0);
    });
});

describe.runIf(hasTestDb())('POST /mux-video-create (e2e, real Postgres)', () => {
    // Lazy: describe bodies run at collection time even when runIf skips
    let pool: pg.Pool;
    const createdProjects: string[] = [];
    const createdWorkspaces: string[] = [];
    /** Subscribed workspace — the gate needs canShare (revamp Step 1) */
    let subscribedWs: string;
    /** Trial-less owner: the fakeClock (2026-01-01) predates the SEEDED users' trials */
    let freeOwner: SeededAuthUser;

    beforeAll(async () => {
        pool = createTestPool();
        const ws = await seedWorkspace(pool, { ownerId: SEEDED_USER_ID });
        createdWorkspaces.push(ws.id);
        await seedSubscription(pool, { workspaceId: ws.id, status: 'active' });
        subscribedWs = ws.id;
        freeOwner = await seedAuthUser(pool);
    });

    afterEach(async () => {
        await deleteProjects(pool, createdProjects);
        createdProjects.length = 0;
    });
    afterAll(async () => {
        await deleteWorkspaces(pool, createdWorkspaces);
        await deleteAuthUsers(pool, [freeOwner.id]);
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
            name: 'Publish me',
            workspaceId: subscribedWs,
            ...opts,
        });
        createdProjects.push(project.id);
        return project;
    }

    interface MuxRow {
        id: string;
        user_id: string;
        cloud_version: number;
        status: string;
        error: string | null;
        mux_asset_id: string | null;
        mux_playback_id: string | null;
        render_storage_path: string | null;
    }

    async function muxRows(projectId: string): Promise<MuxRow[]> {
        const { rows } = await pool.query(
            'SELECT * FROM mux_videos WHERE project_id = $1 ORDER BY created_at',
            [projectId],
        );
        return rows as MuxRow[];
    }

    interface JobRow {
        id: string;
        user_id: string;
        status: string;
        render_storage_path: string | null;
    }

    async function jobRows(projectId: string): Promise<JobRow[]> {
        const { rows } = await pool.query(
            'SELECT * FROM render_jobs WHERE project_id = $1 ORDER BY created_at',
            [projectId],
        );
        return rows as JobRow[];
    }

    it('404 with the exact edge-fn body for an unknown project; no side effects', async () => {
        const { app, deps } = testApp();
        const res = await post(
            app,
            { projectId: '00000000-0000-0000-0000-000000000000', cloudVersion: 1 },
            await ownerToken(),
        );
        expect(res.statusCode).toBe(404);
        expect(res.json()).toEqual({ error: 'Project not found or access denied' });
        expect(deps.mux.createdAssets).toHaveLength(0);
        expect(deps.renderWorker.submissions).toHaveLength(0);
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
        expect(await muxRows(project.id)).toHaveLength(0);
        expect(deps.renderWorker.submissions).toHaveLength(0);
    });

    it('400 with the exact edge-fn body when the project has no share slug; no RPC side effects', async () => {
        const { app, deps } = testApp();
        const project = await seed({ slug: null });

        const res = await post(app, { projectId: project.id, cloudVersion: 1 }, await ownerToken());
        expect(res.statusCode).toBe(400);
        expect(res.json()).toEqual({ error: 'Project not shared. Create a share link first.' });
        expect(await muxRows(project.id)).toHaveLength(0);
        expect(await jobRows(project.id)).toHaveLength(0);
        expect(deps.renderWorker.submissions).toHaveLength(0);
    });

    // Billing revamp Step 1: share plumbing is trial/Pro — a FREE
    // workspace (no subscription, owner without a trial) is denied
    it('403 subscription_required in a free workspace; no side effects', async () => {
        const ws = await seedWorkspace(pool, { ownerId: freeOwner.id });
        createdWorkspaces.push(ws.id);
        const project = await seed({ workspaceId: ws.id });
        const { app, deps } = testApp();

        const res = await post(app, { projectId: project.id, cloudVersion: 1 }, await ownerToken());

        expect(res.statusCode).toBe(403);
        expect(res.json()).toEqual({ error: 'subscription_required' });
        expect(await muxRows(project.id)).toHaveLength(0);
        expect(deps.renderWorker.submissions).toHaveLength(0);
    });

    it('cache hit: existing completed mux_video returned as-is — no render job, no mux call', async () => {
        const { app, deps } = testApp();
        const project = await seed();
        const muxVideoId = await seedMuxVideo(pool, {
            projectId: project.id,
            cloudVersion: 2,
            status: 'completed',
            muxPlaybackId: 'playback-1',
        });

        const res = await post(app, { projectId: project.id, cloudVersion: 2 }, await ownerToken());
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ status: 'completed', muxVideoId });
        expect(await jobRows(project.id)).toHaveLength(0);
        expect(deps.mux.createdAssets).toHaveLength(0);
        expect(deps.renderWorker.submissions).toHaveLength(0);
    });

    it('dedup: an in-flight pending mux_video is returned without side effects', async () => {
        const { app, deps } = testApp();
        const project = await seed();
        const muxVideoId = await seedMuxVideo(pool, {
            projectId: project.id,
            cloudVersion: 1,
            status: 'pending',
        });

        const res = await post(app, { projectId: project.id, cloudVersion: 1 }, await ownerToken());
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ status: 'pending', muxVideoId });
        expect(await muxRows(project.id)).toHaveLength(1);
        expect(await jobRows(project.id)).toHaveLength(0);
        expect(deps.mux.createdAssets).toHaveLength(0);
        expect(deps.renderWorker.submissions).toHaveLength(0);
    });

    it('new mux_video + render pending: render job created and dispatched, NO mux asset yet', async () => {
        const { app, deps } = testApp();
        const project = await seed();

        const res = await post(app, { projectId: project.id, cloudVersion: 3 }, await ownerToken());
        expect(res.statusCode).toBe(200);

        const rows = await muxRows(project.id);
        expect(rows).toHaveLength(1);
        expect(res.json()).toEqual({ status: 'pending', muxVideoId: rows[0].id });
        expect(rows[0]).toMatchObject({
            user_id: SEEDED_USER_ID,
            cloud_version: 3,
            status: 'pending',
            mux_asset_id: null,
        });

        const jobs = await jobRows(project.id);
        expect(jobs).toHaveLength(1);
        expect(jobs[0].status).toBe('pending');
        expect(deps.renderWorker.submissions).toHaveLength(1);
        expect(deps.renderWorker.submissions[0]).toMatchObject({
            jobId: jobs[0].id,
            projectName: 'Publish me',
            statusCallbackUrl: EXPECTED_CALLBACK,
        });
        // The Mux asset is created later, by render-job-hook on completion
        expect(deps.mux.createdAssets).toHaveLength(0);
    });

    it('new mux_video + render already completed: uploads to Mux from the presigned render URL', async () => {
        const { app, deps } = testApp();
        const project = await seed();
        const renderPath = `${SEEDED_USER_ID}/${project.id}/renders/v1.mp4`;
        await seedRenderJob(pool, {
            projectId: project.id,
            cloudVersion: 1,
            status: 'completed',
            renderStoragePath: renderPath,
        });

        const res = await post(app, { projectId: project.id, cloudVersion: 1 }, await ownerToken());
        expect(res.statusCode).toBe(200);

        const rows = await muxRows(project.id);
        expect(rows).toHaveLength(1);
        expect(res.json()).toEqual({ status: 'pending', muxVideoId: rows[0].id });

        // Signed GET of the render, handed to Mux as the asset input
        expect(deps.s3.presignedDownloads).toEqual([
            { key: renderPath, expiresInSeconds: 3600 },
        ]);
        expect(deps.mux.createdAssets).toEqual([
            { assetId: 'fake-mux-asset-1', inputUrl: `https://fake-s3/get/${renderPath}` },
        ]);
        // Status STAYS pending — the Mux webhook (Wave D) completes it
        expect(rows[0]).toMatchObject({
            status: 'pending',
            mux_asset_id: 'fake-mux-asset-1',
            render_storage_path: renderPath,
        });
        // Completed render — nothing re-dispatched to the worker
        expect(deps.renderWorker.submissions).toHaveLength(0);
    });

    it('retry: a failed mux_video is reset (error/mux_asset_id nulled) and the pipeline reruns', async () => {
        const { app, deps } = testApp();
        const project = await seed();
        const muxVideoId = await seedMuxVideo(pool, {
            projectId: project.id,
            cloudVersion: 1,
            status: 'failed',
            error: 'Mux API request failed',
            muxAssetId: 'stale-asset',
        });

        const res = await post(app, { projectId: project.id, cloudVersion: 1 }, await ownerToken());
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ status: 'pending', muxVideoId }); // row reused

        const rows = await muxRows(project.id);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            status: 'pending',
            error: null,
            mux_asset_id: null,
            mux_playback_id: null,
            render_storage_path: null,
        });
        // Fresh render pipeline kicked off
        expect(await jobRows(project.id)).toHaveLength(1);
        expect(deps.renderWorker.submissions).toHaveLength(1);
    });

    it('render failure marks the mux_video failed with `Render dispatch failed` and 500s (pin: no eternal pending)', async () => {
        const { app, deps } = testApp();
        // Throw inside the render service (output-path presign) — the whole
        // render step failing must not leave the mux_video pending
        deps.s3.presignUpload = async () => {
            throw new Error('s3 down');
        };
        const project = await seed();

        const res = await post(app, { projectId: project.id, cloudVersion: 1 }, await ownerToken());
        expect(res.statusCode).toBe(500);

        const rows = await muxRows(project.id);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ status: 'failed', error: 'Render dispatch failed' });
        expect(deps.mux.createdAssets).toHaveLength(0);
    });

    it.each([
        ['network failure', new Error('socket hangup'), 'Mux API request failed'],
        ['API non-2xx', new MuxApiError(503, 'upstream'), 'Mux API error: 503'],
    ])('mux %s marks the row failed with the mapped error string and 500s', async (_name, thrown, expectedError) => {
        const { app, deps } = testApp();
        deps.mux.createAsset = async () => {
            throw thrown;
        };
        const project = await seed();
        await seedRenderJob(pool, {
            projectId: project.id,
            cloudVersion: 1,
            status: 'completed',
        });

        const res = await post(app, { projectId: project.id, cloudVersion: 1 }, await ownerToken());
        expect(res.statusCode).toBe(500);

        const rows = await muxRows(project.id);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ status: 'failed', error: expectedError });
    });

    it('editor-attribution pin: an explicit editor creates rows and render path under the OWNER id', async () => {
        const { app, deps } = testApp();
        const project = await seed({ ownerId: SEEDED_USER_2_ID });
        await seedProjectEditor(pool, { projectId: project.id, userId: SEEDED_USER_ID });

        const res = await post(app, { projectId: project.id, cloudVersion: 1 }, await ownerToken());
        expect(res.statusCode).toBe(200);

        // Unlike the direct /render-job-create route (caller id), BOTH RPCs
        // get the OWNER's id here — edge-fn parity
        expect((await muxRows(project.id))[0].user_id).toBe(SEEDED_USER_2_ID);
        const jobs = await jobRows(project.id);
        expect(jobs[0].user_id).toBe(SEEDED_USER_2_ID);
        expect(jobs[0].render_storage_path).toBe(
            `${SEEDED_USER_2_ID}/${project.id}/renders/v1.mp4`,
        );
        expect(deps.renderWorker.submissions).toHaveLength(1);
    });

    it('contributes project.id, mux.video_status, render.job_id and mux.asset_id to the canonical event', async () => {
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
        await seedRenderJob(pool, {
            projectId: project.id,
            cloudVersion: 1,
            status: 'completed',
        });

        const res = await post(app, { projectId: project.id, cloudVersion: 1 }, await ownerToken());
        expect(res.statusCode).toBe(200);
        expect(lines.find((l) => l.msg === 'request')).toMatchObject({
            'http.route': '/mux-video-create',
            'http.response.status_code': 200,
            'project.id': project.id,
            'mux.video_status': 'pending',
            'mux.asset_id': 'fake-mux-asset-1',
            user_id: SEEDED_USER_ID,
        });
        expect(
            (lines.find((l) => l.msg === 'request') as { 'render.job_id'?: string })['render.job_id'],
        ).toBeTruthy();
    });
});
