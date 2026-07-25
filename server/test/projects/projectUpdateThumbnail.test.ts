/**
 * POST /project-update-thumbnail — e2e against the real local
 * `supabase start` Postgres (merge-blocking tier); fakeS3 for storage.
 * First multipart route: payloads are built with Node's FormData and
 * serialized via `new Response(form)` (body + boundary header for free).
 *
 * Isolation: unique project ids, targeted deletes in afterEach
 * (project_editors cascades with the project).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { buildApp, type App } from '../../src/app.js';
import { createFakeDeps, type FakeDeps } from '../fakes/index.js';
import { TEST_JWT_SECRET, userToken } from '../helpers/tokens.js';
import {
    createTestPool,
    deleteProjects,
    hasTestDb,
    SEEDED_USER_2_ID,
    SEEDED_USER_ID,
    seedProject,
    seedProjectEditor,
} from '../helpers/db.js';

const ownerToken = () => userToken({ sub: SEEDED_USER_ID });

/** Serialize a FormData into an inject-able payload + boundary header. */
async function multipart(form: FormData) {
    const res = new Response(form);
    return {
        payload: Buffer.from(await res.arrayBuffer()),
        contentType: res.headers.get('content-type')!,
    };
}

function thumbnailForm(opts: { projectId?: string; fileBytes?: Buffer } = {}) {
    const form = new FormData();
    if (opts.projectId !== undefined) form.append('projectId', opts.projectId);
    if (opts.fileBytes !== undefined) {
        form.append('file', new Blob([new Uint8Array(opts.fileBytes)], { type: 'image/webp' }), 'thumbnail.webp');
    }
    return form;
}

const WEBP_BYTES = Buffer.from('RIFF....WEBPVP8 fake-webp-content');

async function post(app: App, form: FormData, token?: string) {
    const { payload, contentType } = await multipart(form);
    return app.inject({
        method: 'POST',
        url: '/project-update-thumbnail',
        headers: {
            'content-type': contentType,
            ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        payload,
    });
}

describe('POST /project-update-thumbnail (auth + validation, no db)', () => {
    // Throwing-db deps prove 401/400/413 reject before any query
    function validationApp(): { app: App; deps: FakeDeps } {
        const deps = createFakeDeps();
        const app = buildApp(deps, { supabaseJwtSecret: TEST_JWT_SECRET, logLevel: 'silent' });
        return { app, deps };
    }

    it('401 without a token, same body shape as the edge function', async () => {
        const { app, deps } = validationApp();
        const res = await post(app, thumbnailForm({ projectId: 'p-1', fileBytes: WEBP_BYTES }));
        expect(res.statusCode).toBe(401);
        expect(res.json()).toEqual({ error: 'Unauthorized' });
        expect(deps.s3.objects.size).toBe(0);
    });

    it('400 with the exact edge-fn body when projectId is missing', async () => {
        const { app } = validationApp();
        const res = await post(app, thumbnailForm({ fileBytes: WEBP_BYTES }), await ownerToken());
        expect(res.statusCode).toBe(400);
        expect(res.json()).toEqual({ error: 'Missing projectId or file' });
    });

    it('400 with the exact edge-fn body when the file is missing', async () => {
        const { app } = validationApp();
        const res = await post(app, thumbnailForm({ projectId: 'p-1' }), await ownerToken());
        expect(res.statusCode).toBe(400);
        expect(res.json()).toEqual({ error: 'Missing projectId or file' });
    });

    it('413 with the exact interpolated edge-fn body over 500 KB, no S3 put', async () => {
        const { app, deps } = validationApp();
        const oversize = Buffer.alloc(500 * 1024 + 1, 1);
        const res = await post(
            app,
            thumbnailForm({ projectId: 'p-1', fileBytes: oversize }),
            await ownerToken(),
        );
        expect(res.statusCode).toBe(413);
        expect(res.json()).toEqual({
            error: `Thumbnail too large: ${oversize.length} bytes (max ${500 * 1024})`,
        });
        expect(deps.s3.objects.size).toBe(0);
    });
});

describe.runIf(hasTestDb())('POST /project-update-thumbnail (e2e, real Postgres)', () => {
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
        const app = buildApp(deps, { supabaseJwtSecret: TEST_JWT_SECRET, logLevel: 'silent' });
        return { app, deps: deps as FakeDeps };
    }

    async function seed(opts: Parameters<typeof seedProject>[1] = {}) {
        const project = await seedProject(pool, opts);
        createdProjects.push(project.id);
        return project;
    }

    async function thumbnailPath(projectId: string): Promise<string | null> {
        const { rows } = await pool.query(
            'SELECT thumbnail_storage_path FROM projects WHERE id = $1',
            [projectId],
        );
        return (rows[0] as { thumbnail_storage_path: string | null }).thumbnail_storage_path;
    }

    it('404 with the exact edge-fn body for an unknown project, no S3 put', async () => {
        const { app, deps } = testApp();
        const res = await post(
            app,
            thumbnailForm({ projectId: '00000000-0000-0000-0000-000000000000', fileBytes: WEBP_BYTES }),
            await ownerToken(),
        );
        expect(res.statusCode).toBe(404);
        expect(res.json()).toEqual({ error: 'Project not found or access denied' });
        expect(deps.s3.objects.size).toBe(0);
    });

    it('404 when the project is soft-deleted', async () => {
        const { app } = testApp();
        const project = await seed({ deletedAt: new Date().toISOString() });
        const res = await post(
            app,
            thumbnailForm({ projectId: project.id, fileBytes: WEBP_BYTES }),
            await ownerToken(),
        );
        expect(res.statusCode).toBe(404);
    });

    it('404 for an authed user who is neither owner nor editor; DB unchanged', async () => {
        const { app, deps } = testApp();
        const project = await seed({ ownerId: SEEDED_USER_2_ID });

        const res = await post(
            app,
            thumbnailForm({ projectId: project.id, fileBytes: WEBP_BYTES }),
            await ownerToken(), // SEEDED_USER_ID — no access to user2's project
        );
        expect(res.statusCode).toBe(404);
        expect(res.json()).toEqual({ error: 'Project not found or access denied' });
        expect(deps.s3.objects.size).toBe(0);
        expect(await thumbnailPath(project.id)).toBeNull();
    });

    it('owner: 200, S3 object stored with key/bytes/content-type, DB row updated', async () => {
        const { app, deps } = testApp();
        const project = await seed();

        const res = await post(
            app,
            thumbnailForm({ projectId: project.id, fileBytes: WEBP_BYTES }),
            await ownerToken(),
        );
        expect(res.statusCode).toBe(200);

        const expectedPath = `${SEEDED_USER_ID}/${project.id}/thumbnail.webp`;
        expect(res.json()).toEqual({ storagePath: expectedPath });

        const stored = deps.s3.objects.get(expectedPath);
        expect(stored).toBeDefined();
        expect(Buffer.from(stored!.body)).toEqual(WEBP_BYTES);
        expect(stored!.contentType).toBe('image/webp');

        expect(await thumbnailPath(project.id)).toBe(expectedPath);
    });

    it('explicit project_editors editor: 200, path is namespaced by the CALLER id (edge-fn parity)', async () => {
        const { app, deps } = testApp();
        const project = await seed({ ownerId: SEEDED_USER_2_ID });
        await seedProjectEditor(pool, { projectId: project.id, userId: SEEDED_USER_ID });

        const res = await post(
            app,
            thumbnailForm({ projectId: project.id, fileBytes: WEBP_BYTES }),
            await ownerToken(),
        );
        expect(res.statusCode).toBe(200);
        // Parity subtlety: the key uses the caller's id, not the owner's —
        // an editor's upload lands under the editor's prefix
        const expectedPath = `${SEEDED_USER_ID}/${project.id}/thumbnail.webp`;
        expect(res.json()).toEqual({ storagePath: expectedPath });
        expect(deps.s3.objects.has(expectedPath)).toBe(true);
        expect(await thumbnailPath(project.id)).toBe(expectedPath);
    });

    it('overwrite: a second upload for the same project succeeds with the same path', async () => {
        const { app, deps } = testApp();
        const project = await seed();
        const expectedPath = `${SEEDED_USER_ID}/${project.id}/thumbnail.webp`;

        const first = await post(
            app,
            thumbnailForm({ projectId: project.id, fileBytes: WEBP_BYTES }),
            await ownerToken(),
        );
        expect(first.statusCode).toBe(200);

        const newBytes = Buffer.from('RIFF....WEBPVP8 replaced-content');
        const second = await post(
            app,
            thumbnailForm({ projectId: project.id, fileBytes: newBytes }),
            await ownerToken(),
        );
        expect(second.statusCode).toBe(200);
        expect(second.json()).toEqual({ storagePath: expectedPath });
        expect(Buffer.from(deps.s3.objects.get(expectedPath)!.body)).toEqual(newBytes);
        expect(await thumbnailPath(project.id)).toBe(expectedPath);
    });

    it('contributes project.id and storage.bytes to the canonical request event', async () => {
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

        const res = await post(
            app,
            thumbnailForm({ projectId: project.id, fileBytes: WEBP_BYTES }),
            await ownerToken(),
        );
        expect(res.statusCode).toBe(200);
        expect(lines.find((l) => l.msg === 'request')).toMatchObject({
            'http.route': '/project-update-thumbnail',
            'http.response.status_code': 200,
            'project.id': project.id,
            'storage.bytes': WEBP_BYTES.length,
            user_id: SEEDED_USER_ID,
        });
    });
});
