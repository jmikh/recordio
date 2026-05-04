/**
 * Render worker integration test — fully real, zero mocks.
 *
 * Requires:
 *   - Local Supabase running (`supabase start` + `supabase functions serve`)
 *   - MinIO running (`docker compose up -d minio`) with `project-media` bucket
 *   - ffmpeg installed (for generating test media)
 *   - Playwright Chromium installed (`npx playwright install chromium`)
 *
 * This test starts the real Fastify server, downloads real media from MinIO,
 * renders via real Playwright, uploads the result to MinIO, and reports status
 * to the real render-job-hook edge function.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createApp, createMediaServer } from '../../render-worker/src/server';
import { warmBrowser } from '../../render-worker/src/playwrightRender';
import { uploadToMinio, presignedDownloadUrl, presignedUploadUrl, objectExists } from '../helpers/s3Client';
import { getTestScreenWebm } from '../helpers/testMedia';
import { adminClient, TEST_IDS } from '../helpers/supabaseClient';
import type { FastifyInstance } from 'fastify';
import type * as http from 'node:http';

const RENDER_SECRET = 'TYK3YAYQ5pY7JhGXehGT+DJkyW52Zykf4i8HFN1rnYA=';
const WORKER_PORT = 8095; // Avoid conflict with other test servers
const FUNCTIONS_URL = 'http://127.0.0.1:54321/functions/v1';

let app: FastifyInstance;
let mediaServer: http.Server;

// ── Test project data (schema v5, minimal screen-only) ──────

const TEST_PROJECT_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const SCREEN_STORAGE_PATH = `${TEST_IDS.proUserId}/${TEST_PROJECT_ID}/screen.webm`;
const RENDER_STORAGE_PATH = `renders/${TEST_PROJECT_ID}/output.mp4`;

const testProjectData = {
    id: TEST_PROJECT_ID,
    schemaVersion: 5,
    screenSource: {
        storagePath: SCREEN_STORAGE_PATH,
        durationMs: 1000,
        size: { width: 320, height: 240 },
        hasAudio: false,
    },
    userEvents: {
        mouseClicks: [], mousePositions: [], keyboardEvents: [],
        drags: [], scrolls: [], typingEvents: [], urlChanges: [], hoveredCards: [],
    },
    settings: {
        outputSize: { width: 320, height: 240 },
        frameRate: 30,
        zoom: { enabled: false, maxZoom: 2, transitionDurationMs: 750, easing: 'ease-in-out' },
        spotlight: { enabled: false, dimOpacity: 0.5, enlargeScale: 1.25, transitionDurationMs: 750, minHoldDurationMs: 200, defaultHoldDurationMs: 1000, easing: 'ease-in-out' },
        mouse: { mouseClickEnabled: false, mouseDragEnabled: false, effectType: 'ring', color: '#8b5cf6', size: 1.0, soundEnabled: false, soundVolume: 0.5 },
        keyboard: { showHotkeys: false, hotkeysSize: 1.0, hotkeysPlacement: 'top', hotkeysMargin: 4 },
        screen: {
            mode: 'border', toolbar: { enabled: false, theme: 'light', urlMode: 'short' },
            padding: 0, borderRadiusPx: 0, borderWidthPx: 0, borderColor: '#000000',
            hasShadow: false, hasGlow: false, hasFeather: false, mute: false,
        },
        background: {
            type: 'color', color: '#000000ff', gradientColors: ['#000000ff', '#000000ff'],
            gradientDirection: 0, colorMode: 'solid', backgroundBlurPx: 0,
        },
        captions: { enabled: false, captionSize: 1.0, width: 75, textColor: '#ffffff', backgroundColor: '#000000cc', wordHighlight: false },
        audio: { muteMicrophone: false, muteScreenAudio: false, screenVolume: 1, microphoneVolume: 1, music: { enabled: false, source: 'preset', volume: 0.3, fadeOutDurationMs: 3000 } },
        overlay: { enabled: false, defaultDurationMs: 3000 },
        autoCutApplied: false,
    },
    timeline: {
        id: 'timeline-test',
        durationMs: 1000,
        outputWindows: [{ id: 'ow1', startMs: 0, endMs: 1000, speed: 1 }],
        zoomSegments: [],
        spotlightSegments: [],
        captionSegments: [],
        cameraMoveSegments: [],
        overlaySegments: [],
        focusAreas: [],
        displaySettings: { showZoom: true, showSpotlight: true, showCaptions: false, showCameraMove: false, showOverlay: true, collapsed: false },
    },
};

// ── Setup / Teardown ─────────────────────────────────────────

beforeAll(async () => {
    // 1. Upload test media to MinIO
    const screenFile = getTestScreenWebm();
    await uploadToMinio(SCREEN_STORAGE_PATH, screenFile);

    // 2. Start media file server (serves downloaded files to Playwright)
    mediaServer = createMediaServer();
    await new Promise<void>((resolve) => {
        mediaServer.listen(9998, '127.0.0.1', () => resolve());
    });

    // 3. Warm up Playwright (one-time ~5s cold start)
    await warmBrowser();

    // 4. Start Fastify app
    app = createApp();
    await app.listen({ port: WORKER_PORT, host: '127.0.0.1' });
}, 60_000); // Browser launch can take a while

afterAll(async () => {
    await app?.close();
    await new Promise<void>((resolve) => {
        if (mediaServer) mediaServer.close(() => resolve());
        else resolve();
    });
    // Clean up test project from DB
    await adminClient.from('projects').delete().eq('id', TEST_PROJECT_ID);
    await adminClient.from('render_jobs').delete().eq('project_id', TEST_PROJECT_ID);
});

// ── Tests ────────────────────────────────────────────────────

describe('render worker', () => {
    it('rejects requests without auth', async () => {
        const res = await fetch(`http://127.0.0.1:${WORKER_PORT}/render`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jobId: 'test' }),
        });
        expect(res.status).toBe(401);
    });

    it('rejects requests with wrong secret', async () => {
        const res = await fetch(`http://127.0.0.1:${WORKER_PORT}/render`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer wrong-secret',
            },
            body: JSON.stringify({ jobId: 'test' }),
        });
        expect(res.status).toBe(401);
    });

    it('rejects requests with missing fields', async () => {
        const res = await fetch(`http://127.0.0.1:${WORKER_PORT}/render`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${RENDER_SECRET}`,
            },
            body: JSON.stringify({ jobId: 'test' }),
        });
        expect(res.status).toBe(400);
    });

    it('health check returns ok', async () => {
        const res = await fetch(`http://127.0.0.1:${WORKER_PORT}/health`);
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.status).toBe('ok');
    });

    it('renders a project end-to-end: download → render → upload', async () => {
        // Create a render job in the DB so render-job-hook can update it
        const jobId = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
        await adminClient.from('render_jobs').upsert({
            id: jobId,
            project_id: TEST_PROJECT_ID,
            user_id: TEST_IDS.proUserId,
            cloud_version: 1,
            status: 'pending',
            render_storage_path: RENDER_STORAGE_PATH,
        });

        // Generate presigned URLs (same as edge function does)
        const mediaUrls: Record<string, string> = {
            [SCREEN_STORAGE_PATH]: await presignedDownloadUrl(SCREEN_STORAGE_PATH),
        };
        const uploadUrl = await presignedUploadUrl(RENDER_STORAGE_PATH);
        const statusCallbackUrl = `${FUNCTIONS_URL}/render-job-hook`;

        // POST /render — the full pipeline
        const res = await fetch(`http://127.0.0.1:${WORKER_PORT}/render`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${RENDER_SECRET}`,
            },
            body: JSON.stringify({
                jobId,
                projectData: testProjectData,
                projectName: 'Render Worker Test',
                quality: '1080p',
                mediaUrls,
                uploadUrl,
                statusCallbackUrl,
            }),
        });

        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.ok).toBe(true);
        expect(data.jobId).toBe(jobId);

        // Verify output MP4 was uploaded to MinIO
        const outputExists = await objectExists(RENDER_STORAGE_PATH);
        expect(outputExists).toBe(true);

        // Verify render job was marked completed in DB
        const { data: job } = await adminClient
            .from('render_jobs')
            .select('status')
            .eq('id', jobId)
            .single();
        expect(job?.status).toBe('completed');
    }, 120_000); // Rendering can take a while
});
