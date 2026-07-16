/**
 * Unit tests for POST /storage-download-urls — full HTTP stack via
 * app.inject() with fake deps. No DB involved: the route is auth +
 * path-prefix ownership + S3 presign.
 */
import { describe, expect, it } from 'vitest';
import { buildApp, type App } from '../src/app.js';
import { createFakeDeps, type FakeDeps } from './fakes/index.js';
import { TEST_JWT_SECRET, userToken } from './helpers/tokens.js';

/** Must match the constant in src/routes/storageDownloadUrls.ts (ported from the edge function). */
const ADMIN_USER_ID = '01f290d7-6bfb-4076-8b09-097eca08fc8f';

function testApp(): { app: App; deps: FakeDeps } {
    const deps = createFakeDeps();
    const app = buildApp(deps, { supabaseJwtSecret: TEST_JWT_SECRET, logLevel: 'silent' });
    return { app, deps };
}

async function post(app: App, body: unknown, token?: string) {
    return app.inject({
        method: 'POST',
        url: '/storage-download-urls',
        headers: token ? { authorization: `Bearer ${token}` } : {},
        payload: body as Record<string, unknown>,
    });
}

describe('POST /storage-download-urls', () => {
    it('401 without a token, same body shape as the edge function', async () => {
        const { app } = testApp();
        const res = await post(app, { storagePaths: ['user-1/a.webm'] });
        expect(res.statusCode).toBe(401);
        expect(res.json()).toEqual({ error: 'Unauthorized' });
    });

    it('400 when storagePaths is missing', async () => {
        const { app } = testApp();
        const res = await post(app, {}, await userToken());
        expect(res.statusCode).toBe(400);
    });

    it('400 when storagePaths is empty', async () => {
        const { app } = testApp();
        const res = await post(app, { storagePaths: [] }, await userToken());
        expect(res.statusCode).toBe(400);
    });

    it('rejects non-string entries (Ajv coerces scalars, prefix check catches them — 403 like the edge fn)', async () => {
        const { app } = testApp();
        const res = await post(app, { storagePaths: ['user-1/a.webm', 42] }, await userToken());
        expect(res.statusCode).toBe(403);
    });

    it('403 when any path belongs to another user', async () => {
        const { app, deps } = testApp();
        const res = await post(
            app,
            { storagePaths: ['user-1/mine.webm', 'user-2/theirs.webm'] },
            await userToken(),
        );
        expect(res.statusCode).toBe(403);
        expect(res.json()).toEqual({ error: 'Forbidden' });
        expect(deps.s3.presignedDownloads).toHaveLength(0);
    });

    it('403 when a path merely contains (not starts with) the user id', async () => {
        const { app } = testApp();
        const res = await post(app, { storagePaths: ['evil/user-1/a.webm'] }, await userToken());
        expect(res.statusCode).toBe(403);
    });

    it('returns a signed URL per path with 1h expiry', async () => {
        const { app, deps } = testApp();
        const paths = ['user-1/video.webm', 'user-1/mic.webm'];
        const res = await post(app, { storagePaths: paths }, await userToken());

        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({
            signedUrls: {
                'user-1/video.webm': 'https://fake-s3/get/user-1/video.webm',
                'user-1/mic.webm': 'https://fake-s3/get/user-1/mic.webm',
            },
        });
        expect(deps.s3.presignedDownloads).toEqual([
            { key: 'user-1/video.webm', expiresInSeconds: 3600 },
            { key: 'user-1/mic.webm', expiresInSeconds: 3600 },
        ]);
    });

    it('admin user may request any path (edge-function parity)', async () => {
        const { app } = testApp();
        const res = await post(
            app,
            { storagePaths: ['user-1/a.webm', 'user-2/b.webm'] },
            await userToken({ sub: ADMIN_USER_ID }),
        );
        expect(res.statusCode).toBe(200);
        expect(Object.keys(res.json().signedUrls)).toHaveLength(2);
    });

    it('contributes storage.path_count to the canonical request event', async () => {
        const lines: Record<string, unknown>[] = [];
        const deps = createFakeDeps();
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
        await post(app, { storagePaths: ['user-1/a.webm', 'user-1/b.webm'] }, await userToken());

        const event = lines.find((l) => l.msg === 'request');
        expect(event).toMatchObject({
            'http.route': '/storage-download-urls',
            'http.response.status_code': 200,
            'storage.path_count': 2,
            user_id: 'user-1',
        });
    });
});
