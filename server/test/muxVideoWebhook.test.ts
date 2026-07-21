/**
 * POST /mux-video-webhook — e2e against the real local Postgres
 * (exercises the `mux_video_complete` DB function over the pool);
 * fakeMux drives signature verification (`FAKE_MUX_SIGNATURE`).
 *
 * First raw-body route: the plugin registers a SCOPED content-type
 * parser (raw string), so the suite pins both that the EXACT raw bytes
 * reach the verifier and that other routes still get parsed JSON.
 *
 * Includes the re-publish deadlock pin (fix 2026-07-22): with the
 * one-active-completed unique index gone, a second version's
 * asset.ready completes ALONGSIDE the previous completed row and
 * shared-video-get serves the newest one.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { buildApp, type App } from '../src/app.js';
import { createFakeDeps, FAKE_MUX_SIGNATURE, type FakeDeps } from './fakes/index.js';
import { TEST_JWT_SECRET } from './helpers/tokens.js';
import {
    createTestPool,
    deleteProjects,
    hasTestDb,
    seedMuxVideo,
    seedProject,
} from './helpers/db.js';

const TEST_SUPABASE_URL = 'http://127.0.0.1:54321';

function build(deps: FakeDeps) {
    return buildApp(deps, {
        supabaseJwtSecret: TEST_JWT_SECRET,
        supabaseUrl: TEST_SUPABASE_URL,
        logLevel: 'silent',
    });
}

/** Body goes as a RAW string — the route verifies the exact bytes. */
async function post(app: App, body: string, headers: Record<string, string> = {}) {
    return app.inject({
        method: 'POST',
        url: '/mux-video-webhook',
        headers: { 'content-type': 'application/json', ...headers },
        payload: body,
    });
}

const signed = { 'mux-signature': FAKE_MUX_SIGNATURE };

function readyEvent(assetId: string, playbackId?: string) {
    return JSON.stringify({
        type: 'video.asset.ready',
        data: {
            id: assetId,
            ...(playbackId ? { playback_ids: [{ id: playbackId }] } : {}),
        },
    });
}

describe('POST /mux-video-webhook (auth + dispatch, no db)', () => {
    // Throwing-db deps prove these paths exit before any query
    it('401 with the exact body when the mux-signature header is missing', async () => {
        const app = build(createFakeDeps());
        const res = await post(app, readyEvent('asset-1', 'pb-1'));
        expect(res.statusCode).toBe(401);
        expect(res.json()).toEqual({ error: 'Missing mux-signature header' });
    });

    it('401 with the exact body on a bad signature', async () => {
        const app = build(createFakeDeps());
        const res = await post(app, readyEvent('asset-1', 'pb-1'), { 'mux-signature': 't=1,v1=bad' });
        expect(res.statusCode).toBe(401);
        expect(res.json()).toEqual({ error: 'Invalid signature' });
    });

    it('the EXACT raw string reaches the verifier (no reserialization)', async () => {
        const deps = createFakeDeps();
        const captured: Array<{ rawBody: string; header: string }> = [];
        deps.mux.verifyWebhookSignature = (rawBody, header) => {
            captured.push({ rawBody, header });
            return false;
        };
        const app = build(deps);
        // Non-canonical spacing/key order — any parse+stringify would change it
        const rawBody = '{ "type" : "video.asset.ready",\n  "data": { "playback_ids": [], "id": "a-1" } }';

        const res = await post(app, rawBody, { 'mux-signature': 't=1,v1=whatever' });

        expect(res.statusCode).toBe(401);
        expect(captured).toEqual([{ rawBody, header: 't=1,v1=whatever' }]);
    });

    it('200 acknowledged when data.id is missing (prevents Mux retries)', async () => {
        const app = build(createFakeDeps());
        const res = await post(app, JSON.stringify({ type: 'video.asset.ready', data: {} }), signed);
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ ok: true, message: 'No asset ID, ignoring' });
    });

    it('200 acknowledged for an unhandled event type', async () => {
        const app = build(createFakeDeps());
        const res = await post(
            app,
            JSON.stringify({ type: 'video.asset.created', data: { id: 'asset-x' } }),
            signed,
        );
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ ok: true, message: 'Ignored event: video.asset.created' });
    });
});

describe.runIf(hasTestDb())('POST /mux-video-webhook (e2e, real Postgres)', () => {
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

    /** Unique per test — the route's asset lookups are global on the shared dev DB. */
    function assetId() {
        return `asset-${randomUUID()}`;
    }

    interface MuxRow {
        status: string;
        mux_playback_id: string | null;
        error: string | null;
    }

    async function muxRow(id: string): Promise<MuxRow> {
        const { rows } = await pool.query('SELECT * FROM mux_videos WHERE id = $1', [id]);
        return rows[0] as MuxRow;
    }

    it('asset.ready: the pending row for the asset becomes completed with the playback id', async () => {
        const { app } = testApp();
        const project = await seed();
        const asset = assetId();
        const muxVideoId = await seedMuxVideo(pool, {
            projectId: project.id,
            cloudVersion: 1,
            status: 'pending',
            muxAssetId: asset,
        });

        const res = await post(app, readyEvent(asset, 'pb-ready'), signed);

        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ ok: true });
        expect(await muxRow(muxVideoId)).toMatchObject({
            status: 'completed',
            mux_playback_id: 'pb-ready',
        });
    });

    it('asset.ready for an unknown asset: 200 + message, DB untouched', async () => {
        const { app } = testApp();
        const project = await seed();
        const muxVideoId = await seedMuxVideo(pool, {
            projectId: project.id,
            cloudVersion: 1,
            status: 'pending',
            muxAssetId: assetId(),
        });

        const res = await post(app, readyEvent(assetId(), 'pb-x'), signed);

        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ ok: true, message: 'No matching pending row' });
        expect(await muxRow(muxVideoId)).toMatchObject({ status: 'pending', mux_playback_id: null });
    });

    it('asset.ready WITHOUT a playback id: 500 (Mux will retry), row untouched', async () => {
        const { app } = testApp();
        const project = await seed();
        const asset = assetId();
        const muxVideoId = await seedMuxVideo(pool, {
            projectId: project.id,
            cloudVersion: 1,
            status: 'pending',
            muxAssetId: asset,
        });

        const res = await post(app, readyEvent(asset), signed);

        expect(res.statusCode).toBe(500);
        expect(await muxRow(muxVideoId)).toMatchObject({ status: 'pending', mux_playback_id: null });
    });

    it('asset.errored: the pending row fails with the joined messages', async () => {
        const { app } = testApp();
        const project = await seed();
        const asset = assetId();
        const muxVideoId = await seedMuxVideo(pool, {
            projectId: project.id,
            cloudVersion: 1,
            status: 'pending',
            muxAssetId: asset,
        });

        const res = await post(
            app,
            JSON.stringify({
                type: 'video.asset.errored',
                data: { id: asset, errors: { messages: ['input too short', 'bad codec'] } },
            }),
            signed,
        );

        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ ok: true });
        expect(await muxRow(muxVideoId)).toMatchObject({
            status: 'failed',
            error: 'input too short; bad codec',
        });
    });

    it('asset.errored without messages: the Unknown Mux error default', async () => {
        const { app } = testApp();
        const project = await seed();
        const asset = assetId();
        const muxVideoId = await seedMuxVideo(pool, {
            projectId: project.id,
            cloudVersion: 1,
            status: 'pending',
            muxAssetId: asset,
        });

        await post(app, JSON.stringify({ type: 'video.asset.errored', data: { id: asset } }), signed);

        expect(await muxRow(muxVideoId)).toMatchObject({
            status: 'failed',
            error: 'Unknown Mux error',
        });
    });

    it('asset.errored with no PENDING row: 200 no-op (a completed row is left alone)', async () => {
        const { app } = testApp();
        const project = await seed();
        const asset = assetId();
        const muxVideoId = await seedMuxVideo(pool, {
            projectId: project.id,
            cloudVersion: 1,
            status: 'completed',
            muxAssetId: asset,
            muxPlaybackId: 'pb-done',
        });

        const res = await post(
            app,
            JSON.stringify({ type: 'video.asset.errored', data: { id: asset, errors: { messages: ['late'] } } }),
            signed,
        );

        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ ok: true });
        expect(await muxRow(muxVideoId)).toMatchObject({
            status: 'completed',
            mux_playback_id: 'pb-done',
            error: null,
        });
    });

    it('RE-PUBLISH DEADLOCK PIN: v2 asset.ready completes ALONGSIDE completed v1, shared-video-get serves v2', async () => {
        // Before the 2026-07-22 fix the one-active-completed unique index
        // made this exact webhook 500 forever (and the purge could never
        // break the tie because v2 never completed)
        const { app } = testApp();
        const project = await seed();
        const assetV2 = assetId();
        const v1 = await seedMuxVideo(pool, {
            projectId: project.id,
            cloudVersion: 1,
            status: 'completed',
            muxAssetId: assetId(),
            muxPlaybackId: 'pb-v1',
        });
        const v2 = await seedMuxVideo(pool, {
            projectId: project.id,
            cloudVersion: 2,
            status: 'pending',
            muxAssetId: assetV2,
        });

        const res = await post(app, readyEvent(assetV2, 'pb-v2'), signed);

        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ ok: true });
        expect(await muxRow(v1)).toMatchObject({ status: 'completed', mux_playback_id: 'pb-v1' });
        expect(await muxRow(v2)).toMatchObject({ status: 'completed', mux_playback_id: 'pb-v2' });

        // The existing share page picks the NEWEST completed version
        // (v1 just waits for the daily purge)
        const share = await app.inject({
            method: 'POST',
            url: '/shared-video-get',
            payload: { slug: project.slug },
        });
        expect(share.statusCode).toBe(200);
        expect(share.json()).toMatchObject({ status: 'completed', muxPlaybackId: 'pb-v2' });
    });

    it('the raw-body parser is SCOPED: other routes still get parsed JSON', async () => {
        const { app } = testApp();
        const project = await seed();

        // If the string parser leaked, shared-video-get's body would be a
        // raw string and its object schema would 400
        const res = await app.inject({
            method: 'POST',
            url: '/shared-video-get',
            payload: { slug: project.slug },
        });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toMatchObject({ name: project.name });
    });

    it('contributes mux.asset_id / mux.video_status / project.id to the canonical event', async () => {
        const lines: Record<string, unknown>[] = [];
        const deps = createFakeDeps({ db: pool });
        const app = buildApp(deps, {
            supabaseJwtSecret: TEST_JWT_SECRET,
            supabaseUrl: TEST_SUPABASE_URL,
            logStream: {
                write(chunk: string) {
                    for (const line of chunk.split('\n')) {
                        if (line.trim()) lines.push(JSON.parse(line));
                    }
                },
            },
        });
        const project = await seed();
        const asset = assetId();
        await seedMuxVideo(pool, {
            projectId: project.id,
            cloudVersion: 1,
            status: 'pending',
            muxAssetId: asset,
        });

        const res = await post(app, readyEvent(asset, 'pb-log'), signed);
        expect(res.statusCode).toBe(200);

        expect(lines.find((l) => l.msg === 'request')).toMatchObject({
            'http.route': '/mux-video-webhook',
            'http.response.status_code': 200,
            'mux.asset_id': asset,
            'mux.video_status': 'completed',
            'project.id': project.id,
        });
    });
});
