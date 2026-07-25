/**
 * POST /project-create-v2 — e2e against the real local `supabase start`
 * Postgres (merge-blocking tier). No storage involvement (the TUS
 * upload stays on Supabase); fakeClock pins the 14-day expiry.
 *
 * The round-trip test is load-bearing: Fastify's Ajv strips body
 * properties not in the schema, and `project` is the entire arbitrary
 * editor struct — `additionalProperties: true` must keep every unknown
 * nested field intact all the way into the stored project_data.
 *
 * Isolation: unique project ids + workspaces, targeted deletes.
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
    deleteWorkspaces,
    hasTestDb,
    SEEDED_USER_ID,
    seedSubscription,
    seedWorkspace,
} from '../helpers/db.js';

const ownerToken = () => userToken({ sub: SEEDED_USER_ID });

const DAY_MS = 24 * 60 * 60 * 1000;

function projectStruct(overrides: Record<string, unknown> = {}) {
    return {
        id: randomUUID(),
        screenSource: { kind: 'display', storagePath: '' },
        timeline: { durationMs: 12345.6 },
        ...overrides,
    };
}

async function post(app: App, payload: unknown, token?: string) {
    return app.inject({
        method: 'POST',
        url: '/project-create-v2',
        headers: token ? { authorization: `Bearer ${token}` } : {},
        payload: payload as Record<string, unknown>,
    });
}

describe('POST /project-create-v2 (auth + validation, no db)', () => {
    // Throwing-db deps prove every reject path exits before any query
    function validationApp(): { app: App; deps: FakeDeps } {
        const deps = createFakeDeps();
        const app = buildApp(deps, { supabaseJwtSecret: TEST_JWT_SECRET, logLevel: 'silent' });
        return { app, deps };
    }

    it('401 without a token', async () => {
        const { app } = validationApp();
        const res = await post(app, { project: projectStruct(), workspaceId: 'ws-1' });
        expect(res.statusCode).toBe(401);
        expect(res.json()).toEqual({ error: 'Unauthorized' });
    });

    it('401 with a garbage token', async () => {
        const { app } = validationApp();
        const res = await post(app, { project: projectStruct(), workspaceId: 'ws-1' }, 'not-a-jwt');
        expect(res.statusCode).toBe(401);
    });

    // Fastify default validation 400s replace the edge fn's
    // `Missing workspaceId` / `Missing project or project.id` bodies —
    // documented divergence, same as all waves
    it.each([
        ['missing workspaceId', { project: projectStruct() }],
        ['empty workspaceId', { project: projectStruct(), workspaceId: '' }],
        ['missing project', { workspaceId: 'ws-1' }],
        ['project without id', { project: { screenSource: {} }, workspaceId: 'ws-1' }],
        ['project with empty id', { project: projectStruct({ id: '' }), workspaceId: 'ws-1' }],
    ])('schema 400: %s', async (_name, payload) => {
        const { app } = validationApp();
        const res = await post(app, payload, await ownerToken());
        expect(res.statusCode).toBe(400);
    });
});

describe.runIf(hasTestDb())('POST /project-create-v2 (e2e, real Postgres)', () => {
    // Lazy: describe bodies run at collection time even when runIf skips
    let pool: pg.Pool;
    const createdProjects: string[] = [];
    const createdWorkspaces: string[] = [];

    beforeAll(() => {
        pool = createTestPool();
    });

    afterEach(async () => {
        await deleteProjects(pool, createdProjects);
        await deleteWorkspaces(pool, createdWorkspaces);
        createdProjects.length = 0;
        createdWorkspaces.length = 0;
    });
    afterAll(async () => {
        await pool.end();
    });

    function testApp(): { app: App; deps: FakeDeps } {
        const deps = createFakeDeps({ db: pool });
        const app = buildApp(deps, { supabaseJwtSecret: TEST_JWT_SECRET, logLevel: 'silent' });
        return { app, deps: deps as FakeDeps };
    }

    async function seedWs(subStatus?: string) {
        const ws = await seedWorkspace(pool);
        createdWorkspaces.push(ws.id);
        if (subStatus) await seedSubscription(pool, { workspaceId: ws.id, status: subStatus });
        return ws;
    }

    interface ProjectRow {
        id: string;
        workspace_id: string;
        created_by: string;
        owner_id: string;
        name: string;
        project_data: Record<string, unknown>;
        upload_status: string;
        duration_ms: number | null;
        expires_at: Date | null;
    }

    async function projectRow(id: string): Promise<ProjectRow | undefined> {
        const { rows } = await pool.query('SELECT * FROM projects WHERE id = $1', [id]);
        return rows[0] as ProjectRow | undefined;
    }

    /** POST tracking the project id for cleanup. */
    async function create(app: App, body: Record<string, unknown>) {
        createdProjects.push((body.project as { id: string }).id);
        return post(app, body, await ownerToken());
    }

    it('success: 200, paths stamped for present sources only, pending row with all fields', async () => {
        const { app } = testApp();
        const ws = await seedWs();
        const project = projectStruct({
            cameraSource: { kind: 'webcam', storagePath: '' },
            microphoneSource: { kind: 'mic', storagePath: '' },
        });

        const res = await create(app, { project, name: 'My import', workspaceId: ws.id });
        expect(res.statusCode).toBe(200);

        const prefix = `${SEEDED_USER_ID}/${project.id}`;
        expect(res.json()).toEqual({
            projectId: project.id,
            bucket: 'project-media',
            uploads: [
                { fileType: 'screen', storagePath: `${prefix}/screen.webm` },
                { fileType: 'camera', storagePath: `${prefix}/camera.webm` },
                { fileType: 'mic', storagePath: `${prefix}/mic.wav` },
            ],
        });

        const row = await projectRow(project.id);
        expect(row).toMatchObject({
            workspace_id: ws.id,
            created_by: SEEDED_USER_ID,
            owner_id: SEEDED_USER_ID,
            name: 'My import',
            upload_status: 'pending',
            duration_ms: 12346, // Math.round(12345.6)
        });
        // Stored project_data carries the stamped paths
        const data = row!.project_data as {
            screenSource: { storagePath: string };
            cameraSource: { storagePath: string };
            microphoneSource: { storagePath: string };
        };
        expect(data.screenSource.storagePath).toBe(`${prefix}/screen.webm`);
        expect(data.cameraSource.storagePath).toBe(`${prefix}/camera.webm`);
        expect(data.microphoneSource.storagePath).toBe(`${prefix}/mic.wav`);
    });

    it('screen-only project: single upload entry, no camera/mic stamped', async () => {
        const { app } = testApp();
        const ws = await seedWs();
        const project = projectStruct();

        const res = await create(app, { project, workspaceId: ws.id });
        expect(res.statusCode).toBe(200);
        expect((res.json() as { uploads: unknown[] }).uploads).toEqual([
            { fileType: 'screen', storagePath: `${SEEDED_USER_ID}/${project.id}/screen.webm` },
        ]);
        const data = (await projectRow(project.id))!.project_data;
        expect(data).not.toHaveProperty('cameraSource');
        expect(data).not.toHaveProperty('microphoneSource');
    });

    it('round-trip: arbitrary unknown nested fields survive into project_data verbatim', async () => {
        const { app } = testApp();
        const ws = await seedWs();
        const project = projectStruct({
            settings: {
                background: { storagePath: 'u/bg.webp', blur: 0.5 },
                audio: { music: { storagePath: 'u/song.mp3', volume: 0.8 } },
            },
            userEvents: [{ t: 1, kind: 'click', pos: { x: 1, y: 2 } }],
            someFutureField: { deeply: { nested: ['a', 1, null, true] } },
            zoomRegions: [],
        });

        const res = await create(app, { project, workspaceId: ws.id });
        expect(res.statusCode).toBe(200);

        // Byte-identical apart from the stamped screen path (Ajv
        // removeAdditional would have silently deleted these fields)
        const expected = structuredClone(project) as Record<string, unknown>;
        (expected.screenSource as { storagePath: string }).storagePath =
            `${SEEDED_USER_ID}/${project.id}/screen.webm`;
        expect((await projectRow(project.id))!.project_data).toEqual(expected);
    });

    it.each([
        ['active', true],
        ['past_due', true],
        ['trialing', false],
        ['canceled', false],
    ])('expires_at with a %s subscription: null=%s', async (status, noExpiry) => {
        const { app, deps } = testApp();
        const ws = await seedWs(status);
        const project = projectStruct();

        const res = await create(app, { project, workspaceId: ws.id });
        expect(res.statusCode).toBe(200);

        const row = await projectRow(project.id);
        if (noExpiry) {
            expect(row!.expires_at).toBeNull();
        } else {
            // Pinned by fakeClock: exactly now + 14 days
            const expected = deps.clock.now().getTime() + 14 * DAY_MS;
            expect(row!.expires_at!.getTime()).toBe(expected);
        }
    });

    it('expires_at is set when the workspace has no subscription row', async () => {
        const { app, deps } = testApp();
        const ws = await seedWs();
        const project = projectStruct();

        await create(app, { project, workspaceId: ws.id });
        const row = await projectRow(project.id);
        expect(row!.expires_at!.getTime()).toBe(deps.clock.now().getTime() + 14 * DAY_MS);
    });

    it('name defaults to Untitled; duration_ms null when timeline is absent', async () => {
        const { app } = testApp();
        const ws = await seedWs();
        const project = projectStruct({ timeline: undefined });

        const res = await create(app, { project, workspaceId: ws.id });
        expect(res.statusCode).toBe(200);
        expect(await projectRow(project.id)).toMatchObject({
            name: 'Untitled',
            duration_ms: null,
        });
    });

    it('upsert: a second call with the same project id updates the row (edge-fn parity)', async () => {
        const { app } = testApp();
        const ws = await seedWs('active');
        const project = projectStruct();

        const first = await create(app, { project, name: 'First', workspaceId: ws.id });
        expect(first.statusCode).toBe(200);

        const updated = { ...project, timeline: { durationMs: 2000 }, newField: 'v2' };
        const second = await post(
            app,
            { project: updated, name: 'Second', workspaceId: ws.id },
            await ownerToken(),
        );
        expect(second.statusCode).toBe(200);

        const row = await projectRow(project.id);
        expect(row).toMatchObject({ name: 'Second', duration_ms: 2000 });
        expect(row!.project_data).toHaveProperty('newField', 'v2');
        const { rows } = await pool.query(
            'SELECT COUNT(*)::int AS count FROM projects WHERE id = $1',
            [project.id],
        );
        expect((rows[0] as { count: number }).count).toBe(1);
    });

    it('contributes project.id and workspace.id to the canonical request event', async () => {
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
        const ws = await seedWs();
        const project = projectStruct();

        const res = await create(app, { project, workspaceId: ws.id });
        expect(res.statusCode).toBe(200);
        expect(lines.find((l) => l.msg === 'request')).toMatchObject({
            'http.route': '/project-create-v2',
            'http.response.status_code': 200,
            'project.id': project.id,
            'workspace.id': ws.id,
            user_id: SEEDED_USER_ID,
        });
    });
});
