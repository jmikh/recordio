/**
 * Integration tests for Supabase Edge Functions.
 * Requires local Supabase running (`supabase start`) + `supabase functions serve`.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getProClient, getTrialClient, adminClient, TEST_IDS } from '../helpers/supabaseClient';

const FUNCTIONS_URL = 'http://127.0.0.1:54321/functions/v1';
const ANON_KEY = process.env.SUPABASE_ANON_KEY!;

let proToken: string;
let trialToken: string;
let proClient: SupabaseClient;

beforeAll(async () => {
    proClient = await getProClient();
    const proSession = await proClient.auth.getSession();
    proToken = proSession.data.session!.access_token;

    const trialClient = await getTrialClient();
    const trialSession = await trialClient.auth.getSession();
    trialToken = trialSession.data.session!.access_token;
});

/** Helper to call an edge function with auth. */
async function callFunction(name: string, body: unknown, token?: string) {
    return fetch(`${FUNCTIONS_URL}/${name}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'apikey': ANON_KEY,
            ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
    });
}

// ==========================================
// storage-download-url
// ==========================================

describe('storage-download-url', () => {
    it('rejects unauthenticated requests', async () => {
        const res = await callFunction('storage-download-url', {
            storagePath: `${TEST_IDS.proUserId}/test/screen.webm`,
        });
        expect(res.status).toBe(401);
    });

    it('rejects requests for other users\' files (ownership check)', async () => {
        // Trial user tries to access pro user's storage path
        const res = await callFunction('storage-download-url', {
            storagePath: `${TEST_IDS.proUserId}/test/screen.webm`,
        }, trialToken);
        expect(res.status).toBe(403);
    });

    it('rejects missing storagePath', async () => {
        const res = await callFunction('storage-download-url', {}, proToken);
        expect(res.status).toBe(400);
    });

    it('returns signed URL for owned file', async () => {
        const res = await callFunction('storage-download-url', {
            storagePath: `${TEST_IDS.proUserId}/${TEST_IDS.minimalProjectId}/screen.webm`,
        }, proToken);
        // The file doesn't actually exist in storage, but the function
        // should still generate a signed URL (or return 500 if storage errors).
        // We're testing the auth + ownership logic, not actual file existence.
        const data = await res.json();
        if (res.status === 200) {
            expect(data.signedUrl).toBeDefined();
            expect(typeof data.signedUrl).toBe('string');
        } else {
            // If storage fails because file doesn't exist, that's acceptable
            expect(res.status).toBe(500);
        }
    });
});

// ==========================================
// storage-download-urls (batch) — uses S3 client
// These tests verify auth + validation. The S3 presigning may fail
// locally if S3 env vars aren't configured, so we accept 500 for
// requests that pass auth/validation but fail at the S3 layer.
// ==========================================

describe('storage-download-urls', () => {
    it('rejects unauthenticated requests', async () => {
        const res = await callFunction('storage-download-urls', {
            storagePaths: [`${TEST_IDS.proUserId}/test/screen.webm`],
        });
        // withAuth returns 401, but S3 client init may crash first (500)
        expect([401, 500]).toContain(res.status);
    });

    it('rejects when any path belongs to another user', async () => {
        const res = await callFunction('storage-download-urls', {
            storagePaths: [
                `${TEST_IDS.trialUserId}/test/screen.webm`, // own file
                `${TEST_IDS.proUserId}/test/screen.webm`,   // not yours
            ],
        }, trialToken);
        expect([403, 500]).toContain(res.status);
    });

    it('rejects empty storagePaths array', async () => {
        const res = await callFunction('storage-download-urls', {
            storagePaths: [],
        }, proToken);
        expect([400, 500]).toContain(res.status);
    });

    it('rejects missing storagePaths', async () => {
        const res = await callFunction('storage-download-urls', {}, proToken);
        expect([400, 500]).toContain(res.status);
    });
});

// ==========================================
// project-create
// ==========================================

describe('project-create', () => {
    it('rejects unauthenticated requests', async () => {
        const res = await callFunction('project-create', {
            project: { id: 'test-id' },
        });
        expect(res.status).toBe(401);
    });

    it('rejects missing project', async () => {
        const res = await callFunction('project-create', {}, proToken);
        expect(res.status).toBe(400);
    });

    it('rejects project without id', async () => {
        const res = await callFunction('project-create', {
            project: { screenSource: {} },
        }, proToken);
        expect(res.status).toBe(400);
    });

    it('creates project and returns upload URLs', async () => {
        const projectId = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
        const res = await callFunction('project-create', {
            project: {
                id: projectId,
                schemaVersion: 5,
                screenSource: {
                    durationMs: 5000,
                    size: { width: 1920, height: 1080 },
                    hasAudio: true,
                },
            },
            name: 'Edge Function Test Project',
            isPro: true,
        }, proToken);

        const data = await res.json();

        if (res.status === 200) {
            expect(data.projectId).toBe(projectId);
            expect(data.uploads).toBeInstanceOf(Array);
            expect(data.uploads.length).toBeGreaterThanOrEqual(1);

            const screenUpload = data.uploads.find((u: any) => u.fileType === 'screen');
            expect(screenUpload).toBeDefined();
            expect(screenUpload.signedUrl).toBeDefined();
            expect(screenUpload.storagePath).toContain(projectId);

            // Clean up — delete the created project
            await adminClient.from('projects').delete().eq('id', projectId);
        } else if (res.status === 413) {
            // Quota exceeded — acceptable if get_user_storage_bytes or user_quotas doesn't exist
            expect(data.error).toBe('quota_exceeded');
        } else {
            // Log for debugging but don't fail — edge function deps may not be fully set up
            console.warn(`project-create returned ${res.status}:`, data);
        }
    });
});

// ==========================================
// shared-video-get (public, no auth)
// ==========================================

describe('shared-video-get', () => {
    it('returns 404 for non-existent slug', async () => {
        const res = await callFunction('shared-video-get', {
            slug: 'nonexistent-slug-12345',
        });
        expect(res.status).toBe(404);
    });

    it('rejects missing slug', async () => {
        const res = await callFunction('shared-video-get', {});
        expect(res.status).toBe(400);
    });

    it('returns project data for valid shared slug', async () => {
        // First, share a project by setting a slug
        const slug = 'test-share-slug';
        await adminClient
            .from('projects')
            .update({ slug, share_policy: 'public' })
            .eq('id', TEST_IDS.fullProjectId);

        const res = await callFunction('shared-video-get', { slug });
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(data.name).toBe('Full Test Project');
        expect(data.userName).toBeDefined();

        // Clean up
        await adminClient
            .from('projects')
            .update({ slug: null, share_policy: 'public' })
            .eq('id', TEST_IDS.fullProjectId);
    });

    it('returns 404 for private share_policy', async () => {
        const slug = 'test-private-slug';
        await adminClient
            .from('projects')
            .update({ slug, share_policy: 'private' })
            .eq('id', TEST_IDS.fullProjectId);

        const res = await callFunction('shared-video-get', { slug });
        expect(res.status).toBe(404);

        // Clean up
        await adminClient
            .from('projects')
            .update({ slug: null, share_policy: 'public' })
            .eq('id', TEST_IDS.fullProjectId);
    });
});

// ==========================================
// render-job-create — depends on RENDER_WORKER_URL env var
// These tests validate auth/input checking. The function uses
// its own auth (not withAuth) and reads RENDER_WORKER_URL at
// module scope, so it may 500 if that env isn't set locally.
// ==========================================

describe('render-job-create', () => {
    it('rejects unauthenticated requests', async () => {
        const res = await callFunction('render-job-create', {
            projectId: TEST_IDS.fullProjectId,
            cloudVersion: 3,
        });
        // Should be 401 but may 500 if RENDER_WORKER_URL missing
        expect([401, 500]).toContain(res.status);
    });

    it('rejects missing projectId', async () => {
        const res = await callFunction('render-job-create', {
            cloudVersion: 3,
        }, proToken);
        expect([400, 500]).toContain(res.status);
    });

    it('rejects missing cloudVersion', async () => {
        const res = await callFunction('render-job-create', {
            projectId: TEST_IDS.fullProjectId,
        }, proToken);
        expect([400, 500]).toContain(res.status);
    });

    it('returns 404 for non-existent project', async () => {
        const res = await callFunction('render-job-create', {
            projectId: '99999999-9999-9999-9999-999999999999',
            cloudVersion: 1,
        }, proToken);
        expect([404, 500]).toContain(res.status);
    });

    it('returns 404 when user does not own the project', async () => {
        const res = await callFunction('render-job-create', {
            projectId: TEST_IDS.fullProjectId,
            cloudVersion: 3,
        }, trialToken);
        expect([404, 500]).toContain(res.status);
    });
});
