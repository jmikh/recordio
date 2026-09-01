/**
 * POST /transcribe — e2e against the real local `supabase start`
 * Postgres (merge-blocking tier); fakeS3 holds the mic audio,
 * fakeTranscription plays Whisper. Pure unit tests cover the
 * punctuation/grouping helpers directly.
 *
 * The security-critical case: workspace membership + entitlements
 * (billing revamp Step 1) are the endpoint's ONLY access control — the
 * non-member test proves it survived.
 *
 * Isolation: fresh workspace per test (subscriptions key on
 * workspace_id, and the seeded users' personal workspaces are shared
 * across parallel suites — never attach subscriptions to those).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { buildApp, type App } from '../src/app.js';
import {
    addPunctuationFromSegments,
    groupWordsIntoSegments,
} from '../src/routes/transcribe.js';
import { createFakeDeps, type FakeDeps } from './fakes/index.js';
import { TEST_JWT_SECRET, userToken } from './helpers/tokens.js';
import {
    createTestPool,
    deleteAuthUsers,
    deleteProjects,
    deleteWorkspaces,
    hasTestDb,
    SEEDED_USER_2_ID,
    SEEDED_USER_ID,
    seedAuthUser,
    seedProject,
    seedSubscription,
    seedWorkspace,
    seedWorkspaceMember,
    type SeededAuthUser,
} from './helpers/db.js';

const ownerToken = () => userToken({ sub: SEEDED_USER_ID });

const MIC_PATH = 'u1/p1/mic.wav';
const MIC_PROJECT_DATA = { microphoneSource: { storagePath: MIC_PATH } };
const MIC_BYTES = new Uint8Array([1, 2, 3, 4, 5]);

async function post(app: App, payload: unknown, token?: string) {
    return app.inject({
        method: 'POST',
        url: '/transcribe',
        headers: token ? { authorization: `Bearer ${token}` } : {},
        payload: payload as Record<string, unknown>,
    });
}

describe('transcribe helpers (pure)', () => {
    const word = (w: string, start: number, end: number) => ({
        word: w,
        sourceStartTimeMs: start,
        sourceEndTimeMs: end,
    });

    it('restores punctuation/capitalization from segment tokens in order', () => {
        const words = [word('hello', 0, 400), word('world', 500, 900)];
        const out = addPunctuationFromSegments(words, ['Hello, world.']);
        expect(out.map((w) => w.word)).toEqual(['Hello,', 'world.']);
        // Input untouched (helper copies)
        expect(words[0].word).toBe('hello');
    });

    it('skips a mismatched token and keeps the raw word (heuristic parity)', () => {
        const words = [word('foo', 0, 100), word('bar', 200, 300)];
        const out = addPunctuationFromSegments(words, ['baz bar']);
        // 'baz' doesn't match 'foo' → token consumed, word kept raw;
        // next comparison is 'bar' vs 'bar' → replaced
        expect(out.map((w) => w.word)).toEqual(['foo', 'bar']);
    });

    it('groups words into ±50ms windows, drops orphans, skips empty windows', () => {
        const words = [
            word('a', 0, 400),
            word('b', 500, 950), // 950 <= 900 + 50 → still segment 1
            word('orphan', 5000, 5400), // outside every window → dropped
        ];
        const windows = [
            { start: 0, end: 900 },
            { start: 2000, end: 3000 }, // no words → skipped
        ];
        expect(groupWordsIntoSegments(words, windows)).toEqual([
            { sourceStartTimeMs: 0, sourceEndTimeMs: 950, words: [words[0], words[1]] },
        ]);
    });
});

describe('POST /transcribe (auth + validation, no db)', () => {
    // Throwing-db deps prove every reject path exits before any query
    function validationApp(): { app: App; deps: FakeDeps } {
        const deps = createFakeDeps();
        const app = buildApp(deps, { supabaseJwtSecret: TEST_JWT_SECRET, logLevel: 'silent' });
        return { app, deps };
    }

    it('401 without a token', async () => {
        const { app, deps } = validationApp();
        const res = await post(app, { projectId: 'p-1' });
        expect(res.statusCode).toBe(401);
        expect(res.json()).toEqual({ error: 'Unauthorized' });
        expect(deps.transcription.requests).toHaveLength(0);
    });

    it('401 with a garbage token', async () => {
        const { app } = validationApp();
        const res = await post(app, { projectId: 'p-1' }, 'not-a-jwt');
        expect(res.statusCode).toBe(401);
    });

    // Fastify default validation 400 replaces the edge fn's
    // `Missing projectId` body — documented divergence
    it.each([
        ['missing projectId', {}],
        ['empty projectId', { projectId: '' }],
    ])('schema 400: %s', async (_name, payload) => {
        const { app } = validationApp();
        const res = await post(app, payload, await ownerToken());
        expect(res.statusCode).toBe(400);
    });
});

describe.runIf(hasTestDb())('POST /transcribe (e2e, real Postgres)', () => {
    // Lazy: describe bodies run at collection time even when runIf skips
    let pool: pg.Pool;
    const createdProjects: string[] = [];
    const createdWorkspaces: string[] = [];
    /**
     * Dedicated workspace owners for entitlement-state isolation. The
     * trial lives on the WORKSPACE since revamp Step 2 — seedChain pins
     * trial_ends_at per workspace (helper default: long-expired = free;
     * the trial test pins a date after the 2026-01-01 fakeClock).
     */
    let freeOwner: SeededAuthUser;
    let trialOwner: SeededAuthUser;

    beforeAll(async () => {
        pool = createTestPool();
        freeOwner = await seedAuthUser(pool);
        trialOwner = await seedAuthUser(pool);
    });

    afterEach(async () => {
        await deleteProjects(pool, createdProjects);
        await deleteWorkspaces(pool, createdWorkspaces);
        createdProjects.length = 0;
        createdWorkspaces.length = 0;
    });
    afterAll(async () => {
        await deleteAuthUsers(pool, [freeOwner.id, trialOwner.id]);
        await pool.end();
    });

    function testApp(): { app: App; deps: FakeDeps } {
        const deps = createFakeDeps({ db: pool });
        deps.s3.objects.set(MIC_PATH, { body: MIC_BYTES, contentType: 'audio/wav' });
        const app = buildApp(deps, { supabaseJwtSecret: TEST_JWT_SECRET, logLevel: 'silent' });
        return { app, deps: deps as FakeDeps };
    }

    /** workspace (+ member/sub as requested) + project inside it. */
    async function seedChain(opts: {
        subStatus?: string | null;
        member?: boolean;
        workspaceOwnerId?: string;
        workspaceTrialEndsAt?: string;
        projectData?: unknown;
    } = {}) {
        const ws = await seedWorkspace(pool, {
            ownerId: opts.workspaceOwnerId ?? SEEDED_USER_ID,
            trialEndsAt: opts.workspaceTrialEndsAt,
        });
        createdWorkspaces.push(ws.id);
        if (opts.member !== false) {
            await seedWorkspaceMember(pool, { workspaceId: ws.id, userId: SEEDED_USER_ID });
        }
        if (opts.subStatus !== null) {
            await seedSubscription(pool, {
                workspaceId: ws.id,
                userId: ws.ownerId,
                status: opts.subStatus ?? 'active',
            });
        }
        const project = await seedProject(pool, {
            ownerId: ws.ownerId,
            workspaceId: ws.id,
            projectData: opts.projectData === undefined ? MIC_PROJECT_DATA : opts.projectData,
        });
        createdProjects.push(project.id);
        return project;
    }

    it('404 with the exact edge-fn body for an unknown project', async () => {
        const { app, deps } = testApp();
        const res = await post(
            app,
            { projectId: '00000000-0000-0000-0000-000000000000' },
            await ownerToken(),
        );
        expect(res.statusCode).toBe(404);
        expect(res.json()).toEqual({ error: 'Project not found' });
        expect(deps.transcription.requests).toHaveLength(0);
    });

    it('404 when the project is soft-deleted', async () => {
        const { app } = testApp();
        const project = await seedChain();
        await pool.query('UPDATE projects SET deleted_at = now() WHERE id = $1', [project.id]);
        const res = await post(app, { projectId: project.id }, await ownerToken());
        expect(res.statusCode).toBe(404);
    });

    it('403 for a NON-MEMBER of the project workspace, even with their own active sub elsewhere', async () => {
        const { app, deps } = testApp();
        // Project in user2's workspace with an active sub; caller user1 is
        // NOT a member there (but has an active sub in their own workspace)
        const own = await seedWorkspace(pool, { ownerId: SEEDED_USER_ID });
        createdWorkspaces.push(own.id);
        await seedWorkspaceMember(pool, { workspaceId: own.id, userId: SEEDED_USER_ID });
        await seedSubscription(pool, { workspaceId: own.id, status: 'active' });

        const project = await seedChain({ workspaceOwnerId: SEEDED_USER_2_ID, member: false });

        const res = await post(app, { projectId: project.id }, await ownerToken());
        expect(res.statusCode).toBe(403);
        expect(res.json()).toEqual({ error: 'subscription_required' });
        expect(deps.transcription.requests).toHaveLength(0);
    });

    it('403 for a member whose workspace has no subscription row and no owner trial', async () => {
        const { app } = testApp();
        const project = await seedChain({ subStatus: null, workspaceOwnerId: freeOwner.id });
        const res = await post(app, { projectId: project.id }, await ownerToken());
        expect(res.statusCode).toBe(403);
        expect(res.json()).toEqual({ error: 'subscription_required' });
    });

    it('403 when the subscription status is canceled (no owner trial)', async () => {
        const { app, deps } = testApp();
        const project = await seedChain({ subStatus: 'canceled', workspaceOwnerId: freeOwner.id });
        const res = await post(app, { projectId: project.id }, await ownerToken());
        expect(res.statusCode).toBe(403);
        expect(deps.transcription.requests).toHaveLength(0);
    });

    // Billing revamp Step 1: past_due = full access through Stripe's
    // dunning window (was 403 pre-revamp — inconsistency resolved)
    it('200 when the subscription status is past_due (dunning window)', async () => {
        const { app } = testApp();
        const project = await seedChain({ subStatus: 'past_due' });
        const res = await post(app, { projectId: project.id }, await ownerToken());
        expect(res.statusCode).toBe(200);
    });

    // Billing revamp Steps 1–2: the product trial (now
    // workspaces.trial_ends_at) grants transcription server-side —
    // pre-revamp only Stripe subscription statuses counted
    it('200 for a member of a TRIAL workspace (workspace trial live, no subscription row)', async () => {
        const { app } = testApp();
        const project = await seedChain({
            workspaceOwnerId: trialOwner.id,
            workspaceTrialEndsAt: '2026-06-01T00:00:00Z',
            subStatus: null,
        });
        const res = await post(app, { projectId: project.id }, await ownerToken());
        expect(res.statusCode).toBe(200);
    });

    it('400 with the exact edge-fn body when the project has no mic audio', async () => {
        const { app, deps } = testApp();
        const project = await seedChain({ projectData: { screenSource: { storagePath: 'x' } } });
        const res = await post(app, { projectId: project.id }, await ownerToken());
        expect(res.statusCode).toBe(400);
        expect(res.json()).toEqual({ error: 'Project has no microphone audio' });
        expect(deps.transcription.requests).toHaveLength(0);
    });

    it('success: downloads the mic audio, calls Whisper with mapped mime, returns merged segments', async () => {
        const { app, deps } = testApp();
        const project = await seedChain();

        // Exercises rounding (fractional seconds), punctuation restore,
        // and the ±50ms window in one result
        deps.transcription.result = {
            words: [
                { word: 'hello', start: 0.0004, end: 0.4 },
                { word: 'world', start: 0.5, end: 0.9 },
                { word: 'again', start: 1.2, end: 1.6 },
            ],
            segments: [
                { text: ' Hello, world. ', start: 0, end: 0.95 },
                { text: 'Again.', start: 1.15, end: 1.65 },
            ],
        };

        const res = await post(app, { projectId: project.id }, await ownerToken());
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({
            segments: [
                {
                    sourceStartTimeMs: 0,
                    sourceEndTimeMs: 900,
                    words: [
                        { word: 'Hello,', sourceStartTimeMs: 0, sourceEndTimeMs: 400 },
                        { word: 'world.', sourceStartTimeMs: 500, sourceEndTimeMs: 900 },
                    ],
                },
                {
                    sourceStartTimeMs: 1200,
                    sourceEndTimeMs: 1600,
                    words: [{ word: 'Again.', sourceStartTimeMs: 1200, sourceEndTimeMs: 1600 }],
                },
            ],
        });
        expect(deps.transcription.requests).toEqual([
            { fileName: 'audio.wav', mimeType: 'audio/wav', byteLength: MIC_BYTES.byteLength },
        ]);
    });

    it('maps the mic extension to the right mime (webm)', async () => {
        const { app, deps } = testApp();
        const webmPath = 'u1/p2/mic.webm';
        deps.s3.objects.set(webmPath, { body: MIC_BYTES, contentType: 'audio/webm' });
        const project = await seedChain({
            projectData: { microphoneSource: { storagePath: webmPath } },
        });

        const res = await post(app, { projectId: project.id }, await ownerToken());
        expect(res.statusCode).toBe(200);
        expect(deps.transcription.requests[0]).toMatchObject({
            fileName: 'audio.webm',
            mimeType: 'audio/webm',
        });
    });

    it('returns { segments: [] } when Whisper yields no words', async () => {
        const { app, deps } = testApp();
        const project = await seedChain();
        deps.transcription.result = { words: [], segments: [] };

        const res = await post(app, { projectId: project.id }, await ownerToken());
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ segments: [] });
    });

    it('contributes project.id and storage.bytes to the canonical request event', async () => {
        const lines: Record<string, unknown>[] = [];
        const deps = createFakeDeps({ db: pool });
        deps.s3.objects.set(MIC_PATH, { body: MIC_BYTES, contentType: 'audio/wav' });
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
        const project = await seedChain();

        const res = await post(app, { projectId: project.id }, await ownerToken());
        expect(res.statusCode).toBe(200);
        expect(lines.find((l) => l.msg === 'request')).toMatchObject({
            'http.route': '/transcribe',
            'http.response.status_code': 200,
            'project.id': project.id,
            'storage.bytes': MIC_BYTES.byteLength,
            user_id: SEEDED_USER_ID,
        });
    });
});
