/**
 * POST /screenshot-create — e2e against the real local Postgres
 * (plans/screenshots Step 2). Mirrors projectCreateV2.test.ts: membership
 * gate, the per-kind screenshot cap on free workspaces, path stamping,
 * retry-safe upsert.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { buildApp, type App } from '../../src/app.js';
import { createFakeDeps, type FakeDeps } from '../fakes/index.js';
import { TEST_JWT_SECRET, userToken } from '../helpers/tokens.js';
import {
    createTestPool,
    deleteProjects,
    deleteScreenshots,
    deleteWorkspaces,
    hasTestDb,
    SEEDED_USER_2_ID,
    SEEDED_USER_ID,
    seedProject,
    seedScreenshot,
    seedWorkspace,
    seedWorkspaceMember,
} from '../helpers/db.js';
import { FREE_SCREENSHOT_CAP } from '../../src/services/entitlements.js';

function screenshotDoc(overrides: Record<string, unknown> = {}) {
    return {
        id: randomUUID(),
        schemaVersion: 1,
        source: {
            widthPx: 1440,
            heightPx: 900,
            devicePixelRatio: 2,
            captureMode: 'visible',
            pageUrl: 'https://example.com/page',
            pageTitle: 'Example page',
        },
        cropPx: null,
        annotations: [{ id: 'a1', type: 'arrow', tail: { x: 1, y: 1 }, head: { x: 9, y: 9 } }],
        annotationDefaults: {},
        ...overrides,
    };
}

async function post(app: App, payload: unknown, token?: string) {
    return app.inject({
        method: 'POST',
        url: '/screenshot-create',
        headers: token ? { authorization: `Bearer ${token}` } : {},
        payload: payload as Record<string, unknown>,
    });
}

const ownerToken = () => userToken({ sub: SEEDED_USER_ID });

describe('POST /screenshot-create (auth + validation, no db)', () => {
    function validationApp(): App {
        return buildApp(createFakeDeps(), { supabaseJwtSecret: TEST_JWT_SECRET, logLevel: 'silent' });
    }

    it('401 without a token', async () => {
        const res = await post(validationApp(), { screenshot: screenshotDoc(), workspaceId: 'ws-1' });
        expect(res.statusCode).toBe(401);
    });

    it('400 when the doc has no source block', async () => {
        const res = await post(
            validationApp(),
            { screenshot: { id: randomUUID() }, workspaceId: 'ws-1' },
            await ownerToken(),
        );
        expect(res.statusCode).toBe(400);
    });

    it('400 on an unknown capture mode', async () => {
        const doc = screenshotDoc();
        (doc.source as { captureMode: string }).captureMode = 'window';
        const res = await post(validationApp(), { screenshot: doc, workspaceId: 'ws-1' }, await ownerToken());
        expect(res.statusCode).toBe(400);
    });
});

describe.runIf(hasTestDb())('POST /screenshot-create (e2e, real Postgres)', () => {
    let pool: pg.Pool;
    const createdScreenshots: string[] = [];
    const createdProjects: string[] = [];
    const createdWorkspaces: string[] = [];

    beforeAll(() => {
        pool = createTestPool();
    });
    afterEach(async () => {
        await deleteScreenshots(pool, createdScreenshots);
        createdScreenshots.length = 0;
        await deleteProjects(pool, createdProjects);
        createdProjects.length = 0;
        await deleteWorkspaces(pool, createdWorkspaces);
        createdWorkspaces.length = 0;
    });
    afterAll(async () => {
        await pool.end();
    });

    function testApp(): { app: App; deps: FakeDeps } {
        const deps = createFakeDeps({ db: pool });
        const app = buildApp(deps, { supabaseJwtSecret: TEST_JWT_SECRET, logLevel: 'silent' });
        return { app, deps };
    }

    /** A fresh FREE workspace (seedWorkspace's trial is long expired). */
    async function freeWorkspace(ownerId = SEEDED_USER_ID) {
        const ws = await seedWorkspace(pool, { ownerId });
        createdWorkspaces.push(ws.id);
        return ws;
    }

    async function row(id: string) {
        const { rows } = await pool.query(
            `SELECT name, owner_id, created_by, workspace_id, upload_status, source_storage_path,
                    width_px, height_px, capture_mode, page_url, page_title, slug,
                    screenshot_data
             FROM screenshots WHERE id = $1`,
            [id],
        );
        return rows[0] as Record<string, unknown> | undefined;
    }

    it('403 for a non-member of the workspace, nothing inserted', async () => {
        const ws = await freeWorkspace(SEEDED_USER_2_ID);
        const doc = screenshotDoc();
        const res = await post(testApp().app, { screenshot: doc, workspaceId: ws.id }, await ownerToken());
        expect(res.statusCode).toBe(403);
        expect(res.json()).toEqual({ error: 'Not a member of this workspace' });
        expect(await row(doc.id)).toBeUndefined();
    });

    it('creates a pending row, stamps the source path into the doc AND the columns, returns the slug', async () => {
        const ws = await freeWorkspace();
        const doc = screenshotDoc();
        createdScreenshots.push(doc.id);

        const res = await post(
            testApp().app,
            { screenshot: doc, name: 'Checkout bug', workspaceId: ws.id },
            await ownerToken(),
        );
        expect(res.statusCode).toBe(200);
        const expectedPath = `${SEEDED_USER_ID}/screenshots/${doc.id}/source.png`;
        const body = res.json();
        expect(body).toMatchObject({
            screenshotId: doc.id,
            bucket: 'project-media',
            storagePath: expectedPath,
        });
        expect(body.slug).toMatch(/^[0-9a-f]{12}$/);

        const stored = await row(doc.id);
        expect(stored).toMatchObject({
            name: 'Checkout bug',
            owner_id: SEEDED_USER_ID,
            created_by: SEEDED_USER_ID,
            workspace_id: ws.id,
            upload_status: 'pending',
            source_storage_path: expectedPath,
            width_px: 1440,
            height_px: 900,
            capture_mode: 'visible',
            page_url: 'https://example.com/page',
            page_title: 'Example page',
            slug: body.slug,
        });
        // The whole doc round-trips (annotations untouched) with the path stamped in
        const data = stored!.screenshot_data as { source: { storagePath: string }; annotations: unknown[] };
        expect(data.source.storagePath).toBe(expectedPath);
        expect(data.annotations).toHaveLength(1);
    });

    it('name defaults to Untitled; a retry with the same id upserts instead of failing', async () => {
        const ws = await freeWorkspace();
        const doc = screenshotDoc();
        createdScreenshots.push(doc.id);
        const { app } = testApp();

        const first = await post(app, { screenshot: doc, workspaceId: ws.id }, await ownerToken());
        expect(first.statusCode).toBe(200);
        expect((await row(doc.id))!.name).toBe('Untitled');

        const second = await post(app, { screenshot: doc, name: 'Renamed on retry', workspaceId: ws.id }, await ownerToken());
        expect(second.statusCode).toBe(200);
        expect(second.json().slug).toBe(first.json().slug);
        expect((await row(doc.id))!.name).toBe('Renamed on retry');
    });

    describe('screenshot cap (free workspaces)', () => {
        async function seedLive(workspaceId: string, count: number, opts: Parameters<typeof seedScreenshot>[1] = {}) {
            for (let i = 0; i < count; i++) {
                const s = await seedScreenshot(pool, { workspaceId, ...opts });
                createdScreenshots.push(s.id);
            }
        }

        it(`403 screenshot_cap_reached at ${FREE_SCREENSHOT_CAP} live screenshots`, async () => {
            const ws = await freeWorkspace();
            await seedLive(ws.id, FREE_SCREENSHOT_CAP);
            const doc = screenshotDoc();
            const res = await post(testApp().app, { screenshot: doc, workspaceId: ws.id }, await ownerToken());
            expect(res.statusCode).toBe(403);
            expect(res.json()).toEqual({ error: 'screenshot_cap_reached', cap: FREE_SCREENSHOT_CAP });
            expect(await row(doc.id)).toBeUndefined();
        });

        it('deleted, pending, other-owner screenshots and VIDEO PROJECTS do not count', async () => {
            const ws = await freeWorkspace();
            await seedLive(ws.id, FREE_SCREENSHOT_CAP - 1);
            await seedLive(ws.id, 1, { deletedAt: new Date().toISOString() });
            await seedLive(ws.id, 1, { uploadStatus: 'pending' });
            await seedLive(ws.id, 1, { ownerId: SEEDED_USER_2_ID });
            // Videos have their own cap — a full video library must not block screenshots
            for (let i = 0; i < 6; i++) {
                const p = await seedProject(pool, { workspaceId: ws.id, uploadStatus: 'ready' });
                createdProjects.push(p.id);
            }
            const doc = screenshotDoc();
            createdScreenshots.push(doc.id);
            const res = await post(testApp().app, { screenshot: doc, workspaceId: ws.id }, await ownerToken());
            expect(res.statusCode).toBe(200);
        });

        it('a trial workspace is uncapped', async () => {
            const ws = await seedWorkspace(pool, { trialEndsAt: '2100-01-01T00:00:00Z' });
            createdWorkspaces.push(ws.id);
            await seedLive(ws.id, FREE_SCREENSHOT_CAP);
            const doc = screenshotDoc();
            createdScreenshots.push(doc.id);
            const res = await post(testApp().app, { screenshot: doc, workspaceId: ws.id }, await ownerToken());
            expect(res.statusCode).toBe(200);
        });

        it('the cap is per workspace member: a member with their own quota can still create', async () => {
            const ws = await freeWorkspace();
            await seedWorkspaceMember(pool, { workspaceId: ws.id, userId: SEEDED_USER_2_ID, role: 'creator' });
            await seedLive(ws.id, FREE_SCREENSHOT_CAP); // all owned by user 1
            const doc = screenshotDoc();
            createdScreenshots.push(doc.id);
            const res = await post(
                testApp().app,
                { screenshot: doc, workspaceId: ws.id },
                await userToken({ sub: SEEDED_USER_2_ID }),
            );
            expect(res.statusCode).toBe(200);
            expect((await row(doc.id))!.owner_id).toBe(SEEDED_USER_2_ID);
        });
    });
});
