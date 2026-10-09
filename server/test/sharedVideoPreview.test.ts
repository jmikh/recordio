/**
 * POST /shared-video-preview + GET /shared-video-preview-image/:slug —
 * e2e against the real local `supabase start` Postgres (same tier as
 * sharedVideoGet.test.ts). Only third parties are faked: supabaseApi
 * (owner names) and S3 (the thumbnail).
 *
 * Both routes are read-only and must never dispatch: the side-effect
 * assertion is that no mux_videos / render_jobs row appears.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import sharp from 'sharp';
import { buildApp, type App } from '../src/app.js';
import { renderGenericPreviewCard } from '../src/services/sharePreviewImage.js';
import { createFakeDeps, type FakeDeps } from './fakes/index.js';
import { TEST_JWT_SECRET } from './helpers/tokens.js';
import { createTestPool, deleteProjects, hasTestDb, seedProject } from './helpers/db.js';

/** 3:42 of output: two windows, the second at 2× speed */
const TIMELINE = {
    timeline: {
        outputWindows: [
            { id: 'w1', startMs: 0, endMs: 200_000 },
            { id: 'w2', startMs: 300_000, endMs: 345_800, speed: 2 },
        ],
    },
};
const DURATION_MS = 200_000 + 22_900;

async function postPreview(app: App, body: unknown) {
    return app.inject({
        method: 'POST',
        url: '/shared-video-preview',
        payload: body as Record<string, unknown>,
    });
}

async function getImage(app: App, slug: string) {
    return app.inject({ method: 'GET', url: `/shared-video-preview-image/${encodeURIComponent(slug)}` });
}

describe('shared video preview routes (validation, no db)', () => {
    function validationApp(): App {
        return buildApp(createFakeDeps(), { supabaseJwtSecret: TEST_JWT_SECRET, logLevel: 'silent' });
    }

    it('400 when slug is missing or empty', async () => {
        const app = validationApp();
        expect((await postPreview(app, {})).statusCode).toBe(400);
        expect((await postPreview(app, { slug: '' })).statusCode).toBe(400);
    });

    it('preview allows the global ceiling (300/min) — its callers share Cloudflare IPs', async () => {
        const app = validationApp();
        for (let i = 0; i < 300; i++) {
            expect((await postPreview(app, { slug: '' })).statusCode).toBe(400);
        }
        expect((await postPreview(app, { slug: '' })).statusCode).toBe(429);
    });
});

describe.runIf(hasTestDb())('shared video preview routes (e2e, real Postgres)', () => {
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
        const app = buildApp(deps, { supabaseJwtSecret: TEST_JWT_SECRET, logLevel: 'silent' });
        return { app, deps: deps as FakeDeps };
    }

    async function seed(opts: Parameters<typeof seedProject>[1] = {}) {
        const project = await seedProject(pool, opts);
        createdProjects.push(project.id);
        return project;
    }

    /** seedProject has no thumbnail option; the editor upload sets this column */
    async function withThumbnail(deps: FakeDeps, projectId: string, ownerId: string) {
        const key = `${ownerId}/${projectId}/thumbnail.webp`;
        await pool.query('UPDATE projects SET thumbnail_storage_path = $2 WHERE id = $1', [projectId, key]);
        const body = await sharp({ create: { width: 1200, height: 675, channels: 3, background: '#336699' } })
            .webp().toBuffer();
        deps.s3.objects.set(key, { body: new Uint8Array(body), contentType: 'image/webp' });
        return key;
    }

    async function dispatchedRows(projectId: string): Promise<number> {
        const { rows } = await pool.query(
            `SELECT (SELECT count(*) FROM mux_videos WHERE project_id = $1)
                  + (SELECT count(*) FROM render_jobs WHERE project_id = $1) AS n`,
            [projectId],
        );
        return Number((rows[0] as { n: string }).n);
    }

    // ── POST /shared-video-preview ──

    it('public: name, owner and output duration (cuts and speed applied)', async () => {
        const { app, deps } = testApp();
        const project = await seed({ name: 'New billing flow', projectData: TIMELINE, uploadStatus: 'ready' });
        deps.supabaseApi.users.set(project.ownerId, { userMetadata: { full_name: 'Sam Rivera' } });

        const res = await postPreview(app, { slug: project.slug });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ name: 'New billing flow', ownerName: 'Sam Rivera', durationMs: DURATION_MS });
        // A crawler hit must never start a render, even on a ready project
        expect(await dispatchedRows(project.id)).toBe(0);
    });

    it('omits durationMs when the timeline has no usable windows', async () => {
        const { app } = testApp();
        const project = await seed({ projectData: {} });
        const res = await postPreview(app, { slug: project.slug });
        expect(res.statusCode).toBe(200);
        expect(res.json()).not.toHaveProperty('durationMs');
    });

    it('owner name degrades to Unknown when the lookup finds nobody', async () => {
        const { app } = testApp();
        const project = await seed();
        expect((await postPreview(app, { slug: project.slug })).json().ownerName).toBe('Unknown');
    });

    it.each([
        ['private', { sharePolicy: 'private' }],
        ['workspace', { sharePolicy: 'workspace' }],
        ['deleted', { deletedAt: new Date().toISOString() }],
    ])('%s → the same 404 as an unknown slug', async (_label, opts) => {
        const { app } = testApp();
        const project = await seed(opts);
        const res = await postPreview(app, { slug: project.slug });
        expect(res.statusCode).toBe(404);
        expect(res.json()).toEqual({ error: 'not_found' });

        const unknown = await postPreview(app, { slug: 'no-such-slug' });
        expect(unknown.statusCode).toBe(404);
        expect(unknown.json()).toEqual(res.json());
    });

    // ── GET /shared-video-preview-image/:slug ──

    it('public with a thumbnail → the video card, cacheable', async () => {
        const { app, deps } = testApp();
        const project = await seed({ projectData: TIMELINE });
        await withThumbnail(deps, project.id, project.ownerId);

        const res = await getImage(app, project.slug);
        expect(res.statusCode).toBe(200);
        expect(res.headers['content-type']).toBe('image/png');
        expect(res.headers['cache-control']).toBe('public, max-age=3600');
        const meta = await sharp(res.rawPayload).metadata();
        expect([meta.format, meta.width, meta.height]).toEqual(['png', 1200, 675]);
        expect(res.rawPayload.equals(await renderGenericPreviewCard())).toBe(false);
        expect(await dispatchedRows(project.id)).toBe(0);
    });

    it.each([
        ['private', { sharePolicy: 'private' }],
        ['workspace', { sharePolicy: 'workspace' }],
        ['deleted', { deletedAt: new Date().toISOString() }],
    ])('%s (even with a thumbnail) → the generic card', async (_label, opts) => {
        const { app, deps } = testApp();
        const project = await seed(opts);
        await withThumbnail(deps, project.id, project.ownerId);

        const res = await getImage(app, project.slug);
        expect(res.statusCode).toBe(200);
        expect(res.rawPayload.equals(await renderGenericPreviewCard())).toBe(true);
    });

    it('unknown slug and public-without-thumbnail → the generic card', async () => {
        const { app } = testApp();
        const project = await seed();
        for (const slug of ['no-such-slug', project.slug]) {
            const res = await getImage(app, slug);
            expect(res.statusCode).toBe(200);
            expect(res.headers['content-type']).toBe('image/png');
            expect(res.rawPayload.equals(await renderGenericPreviewCard())).toBe(true);
        }
    });

    it('thumbnail path set but the object is gone → the generic card, not a 500', async () => {
        const { app, deps } = testApp();
        const project = await seed();
        const key = await withThumbnail(deps, project.id, project.ownerId);
        deps.s3.objects.delete(key);

        const res = await getImage(app, project.slug);
        expect(res.statusCode).toBe(200);
        expect(res.rawPayload.equals(await renderGenericPreviewCard())).toBe(true);
    });
});
