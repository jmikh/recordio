/**
 * POST /project-clone — the impersonation toolbar's Clone button.
 *
 * Unit tier: the gate (no token, a plain session token, no allowlist).
 * E2e tier: a real clone against Postgres — ownership, destination
 * workspace, the rewritten storage paths in project_data, and the S3
 * copies those paths point at (fake S3, seeded with the source objects).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { buildApp, type App } from '../../src/app.js';
import { createFakeDeps, type FakeDeps } from '../fakes/index.js';
import { signToken, TEST_JWT_SECRET, userToken } from '../helpers/tokens.js';
import {
    createTestPool,
    deleteAuthUsers,
    deleteProjects,
    hasTestDb,
    seedAuthUser,
    seedProject,
    type SeededAuthUser,
} from '../helpers/db.js';

function post(app: App, token?: string, payload: Record<string, unknown> = {}) {
    return app.inject({
        method: 'POST',
        url: '/project-clone',
        headers: token ? { authorization: `Bearer ${token}` } : {},
        payload,
    });
}

describe('POST /project-clone (gate, no db)', () => {
    function app(adminEmails?: string) {
        return buildApp(createFakeDeps(), {
            supabaseJwtSecret: TEST_JWT_SECRET,
            logLevel: 'silent',
            adminEmails,
        });
    }

    it('401 without a token', async () => {
        expect((await post(app('admin@example.com'))).statusCode).toBe(401);
    });

    it('403 for a normal session token — no impersonation claim', async () => {
        // Rejected before any query: the throwing fake db would 500 otherwise
        const res = await post(app('admin@example.com'), await userToken(), { slug: 's' });
        expect(res.statusCode).toBe(403);
    });

    it('403 when no allowlist is configured (fail closed)', async () => {
        const token = await signToken({
            sub: 'target', role: 'authenticated', impersonated_by: 'admin-id',
        });
        expect((await post(app(undefined), token, { slug: 's' })).statusCode).toBe(403);
    });
});

describe.runIf(hasTestDb())('POST /project-clone (e2e, real Postgres)', () => {
    let pool: pg.Pool;
    let admin: SeededAuthUser;
    let target: SeededAuthUser;
    let adminWorkspaceId: string;
    const createdUsers: string[] = [];
    const createdProjects: string[] = [];

    beforeAll(async () => {
        pool = createTestPool();
        // Both keep their signup-bootstrap workspace: the admin's is the
        // clone's destination, the target's holds the source project
        admin = await seedAuthUser(pool, { name: 'Admin', keepBootstrapWorkspace: true });
        target = await seedAuthUser(pool, { name: 'Target', keepBootstrapWorkspace: true });
        createdUsers.push(admin.id, target.id);
        const { rows } = await pool.query(
            'SELECT id FROM workspaces WHERE owner_id = $1',
            [admin.id],
        );
        adminWorkspaceId = (rows[0] as { id: string }).id;
    });

    afterAll(async () => {
        await deleteProjects(pool, createdProjects);
        if (createdUsers.length > 0) {
            await pool.query('DELETE FROM workspaces WHERE owner_id = ANY($1::uuid[])', [createdUsers]);
        }
        await deleteAuthUsers(pool, createdUsers);
        await pool.end();
    });

    function testApp(): { app: App; deps: FakeDeps } {
        const deps = createFakeDeps({ db: pool });
        const app = buildApp(deps, {
            supabaseJwtSecret: TEST_JWT_SECRET,
            logLevel: 'silent',
            adminEmails: admin.email,
        });
        return { app, deps };
    }

    /** The token the webapp sends while impersonating `userId`. */
    function impersonationToken(userId: string, adminId = admin.id) {
        return signToken({
            sub: userId,
            role: 'authenticated',
            impersonated_by: adminId,
        });
    }

    /** A ready project owned by `ownerId`, with media seeded into fake S3. */
    async function seedReadyProject(deps: FakeDeps, ownerId: string, sharePolicy = 'public') {
        const project = await seedProject(pool, {
            ownerId,
            uploadStatus: 'ready',
            sharePolicy,
            // Unique per case: the rollback case counts clones by name
            name: `Clone source ${randomUUID().slice(0, 8)}`,
        });
        createdProjects.push(project.id);

        const screen = `${ownerId}/${project.id}/screen.webm`;
        const mic = `${ownerId}/${project.id}/mic.wav`;
        const music = `${ownerId}/assets/track-1.mp3`;
        const thumbnail = `${ownerId}/${project.id}/thumbnail.webp`;
        const projectData = {
            id: project.id,
            schemaVersion: 7,
            screenSource: { storagePath: screen, widthPx: 1920 },
            microphoneSource: { storagePath: mic },
            settings: { audio: { music: { source: 'custom', storagePath: music } } },
            timeline: { durationMs: 4242 },
        };
        await pool.query(
            `UPDATE projects SET project_data = $2::jsonb, thumbnail_storage_path = $3,
                    duration_ms = 4242
             WHERE id = $1`,
            [project.id, JSON.stringify(projectData), thumbnail],
        );
        for (const key of [screen, mic, music, thumbnail]) {
            deps.s3.objects.set(key, { body: new TextEncoder().encode(key), contentType: 'application/octet-stream' });
        }
        return { project, paths: { screen, mic, music, thumbnail } };
    }

    it('copies the project and its media into the admin default workspace', async () => {
        const { app, deps } = testApp();
        const { project, paths } = await seedReadyProject(deps, target.id);

        const res = await post(app, await impersonationToken(target.id), { slug: project.slug });
        expect(res.statusCode).toBe(200);
        const body = res.json() as {
            projectId: string; slug: string; workspaceId: string; name: string;
        };
        createdProjects.push(body.projectId);

        expect(body.workspaceId).toBe(adminWorkspaceId);
        expect(body.name).toBe(`${project.name} (clone)`);
        expect(body.slug).not.toBe(project.slug);

        const { rows } = await pool.query(
            `SELECT owner_id, created_by, workspace_id, upload_status, duration_ms,
                    thumbnail_storage_path, project_data
             FROM projects WHERE id = $1`,
            [body.projectId],
        );
        const row = rows[0] as {
            owner_id: string; created_by: string; workspace_id: string;
            upload_status: string; duration_ms: number; thumbnail_storage_path: string;
            project_data: {
                id: string;
                schemaVersion: number;
                screenSource: { storagePath: string; widthPx: number };
                microphoneSource: { storagePath: string };
                settings: { audio: { music: { storagePath: string } } };
            };
        };
        expect(row.owner_id).toBe(admin.id);
        expect(row.created_by).toBe(admin.id);
        expect(row.workspace_id).toBe(adminWorkspaceId);
        expect(row.upload_status).toBe('ready');
        expect(row.duration_ms).toBe(4242);

        const prefix = `${admin.id}/${body.projectId}/`;
        // Every path in the blob is rewritten under the ADMIN's prefix —
        // /storage-download-urls authorizes by exactly that prefix
        expect(row.project_data.id).toBe(body.projectId);
        expect(row.project_data.screenSource.storagePath).toBe(`${prefix}screen.webm`);
        expect(row.project_data.microphoneSource.storagePath).toBe(`${prefix}mic.wav`);
        expect(row.project_data.settings.audio.music.storagePath).toBe(`${prefix}assets/track-1.mp3`);
        expect(row.thumbnail_storage_path).toBe(`${prefix}thumbnail.webp`);
        // Untouched fields ride along verbatim
        expect(row.project_data.schemaVersion).toBe(7);
        expect(row.project_data.screenSource.widthPx).toBe(1920);

        // …and the objects those paths name actually exist now
        for (const key of [
            `${prefix}screen.webm`,
            `${prefix}mic.wav`,
            `${prefix}assets/track-1.mp3`,
            `${prefix}thumbnail.webp`,
        ]) {
            expect(deps.s3.objects.has(key)).toBe(true);
        }
        // The originals are left alone
        expect(deps.s3.objects.has(paths.screen)).toBe(true);
        expect(deps.s3.deletedKeys).toEqual([]);
    });

    it('404 for an unknown slug', async () => {
        const { app } = testApp();
        const res = await post(app, await impersonationToken(target.id), { slug: 'no-such-slug' });
        expect(res.statusCode).toBe(404);
    });

    it('400 when neither projectId nor slug is given', async () => {
        const { app } = testApp();
        expect((await post(app, await impersonationToken(target.id))).statusCode).toBe(400);
    });

    it('403 when the impersonated user cannot view the project', async () => {
        const { app, deps } = testApp();
        const stranger = await seedAuthUser(pool, { keepBootstrapWorkspace: true });
        createdUsers.push(stranger.id);
        const { project } = await seedReadyProject(deps, stranger.id, 'private');

        const res = await post(app, await impersonationToken(target.id), { slug: project.slug });
        expect(res.statusCode).toBe(403);
    });

    it('403 when the impersonating admin is not on the allowlist', async () => {
        const { app, deps } = testApp();
        const { project } = await seedReadyProject(deps, target.id);
        // Signed claim, but this id's email is not allowlisted
        const res = await post(app, await impersonationToken(target.id, target.id), { slug: project.slug });
        expect(res.statusCode).toBe(403);
    });

    it('400 while the source media is still uploading', async () => {
        const { app, deps } = testApp();
        const { project } = await seedReadyProject(deps, target.id);
        await pool.query(`UPDATE projects SET upload_status = 'pending' WHERE id = $1`, [project.id]);

        const res = await post(app, await impersonationToken(target.id), { slug: project.slug });
        expect(res.statusCode).toBe(400);
    });

    it('leaves nothing behind when a media object is missing', async () => {
        const { app, deps } = testApp();
        const { project, paths } = await seedReadyProject(deps, target.id);
        deps.s3.objects.delete(paths.mic);
        const before = deps.s3.objects.size;

        const res = await post(app, await impersonationToken(target.id), { slug: project.slug });
        expect(res.statusCode).toBe(500);
        // The screen copy that already succeeded is rolled back
        expect(deps.s3.objects.size).toBe(before);
        const { rows } = await pool.query(
            'SELECT count(*)::int AS count FROM projects WHERE owner_id = $1 AND name = $2',
            [admin.id, `${project.name} (clone)`],
        );
        expect((rows[0] as { count: number }).count).toBe(0);
    });
});
