/**
 * Render worker Fastify server.
 *
 * Deployed on Google Cloud Run. Receives render jobs from the render-sync
 * edge function with signed URLs for media download/upload. Has zero Supabase
 * credentials — reports status via HTTP callback to render-job-hook.
 *
 * Concurrency model:
 *  - POST /render returns 200 immediately (job accepted)
 *  - Media downloads run in parallel across jobs
 *  - Playwright renders are serialized via a queue (one at a time on the GPU)
 */

import Fastify from 'fastify';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { config } from './config.js';
import { downloadMedia, type MediaUrls } from './downloadMedia.js';
import { renderViaPlaywright, warmBrowser, RENDER_PAGE_DIST, getMimeType } from './playwrightRender.js';

// ── Per-job media directories (for direct HTTP serving) ──────
// Registered when a job starts, removed on cleanup. Keyed by jobId.
const activeMediaDirs = new Map<string, string>();

// ── Per-job result receive (render page POSTs MP4 here to bypass CDP) ──
const pendingResults = new Map<string, { resolve: (filePath: string) => void }>();

/** Create a promise that resolves when the render page POSTs the result. */
export function waitForResult(jobId: string): Promise<string> {
    let resolve!: (filePath: string) => void;
    const promise = new Promise<string>((r) => { resolve = r; });
    pendingResults.set(jobId, { resolve });
    return promise;
}

// ── Render queue (serialize Playwright renders) ─────────────
// Downloads happen in parallel, but only one Playwright render
// runs at a time to avoid GPU contention.

const renderQueue: Array<() => void> = [];
let renderRunning = false;

function acquireRenderSlot(): Promise<void> {
    if (!renderRunning) {
        renderRunning = true;
        return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
        renderQueue.push(resolve);
    });
}

function releaseRenderSlot(): void {
    const next = renderQueue.shift();
    if (next) {
        next(); // hand the slot to the next waiter
    } else {
        renderRunning = false;
    }
}


// ── Render body interface ────────────────────────────────────

export interface RenderBody {
    jobId: string;
    projectData: unknown;
    projectName?: string;
    quality: string;
    mediaUrls: MediaUrls;
    uploadUrl: string;
    statusCallbackUrl: string;
}

// ── Fastify app factory ──────────────────────────────────────
// Extracted so tests can create an app without booting Playwright.

export function createApp() {
    const app = Fastify({
        // 2GB limit for receiving rendered MP4 results from the browser
        bodyLimit: 2 * 1024 * 1024 * 1024,
        logger: {
            level: 'info',
            transport: process.env.NODE_ENV !== 'production'
                ? { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss' } }
                : undefined,
        },
    });

    // ── Health check ──────────────────────────────────────────────

    app.get('/health', async () => ({ status: 'ok' }));

    // ── Serve render-page static files as fallback ──────────────────
    // Replaces Playwright route interception — serving via Fastify avoids
    // enabling CDP Fetch, which would serialize ALL network traffic through
    // the pipe and crash on large payloads (>512MB).
    // Registered as the not-found handler so explicit routes take priority.

    app.setNotFoundHandler(async (request, reply) => {
        if (request.method !== 'GET') {
            return reply.code(404).send({ error: 'Not found' });
        }

        const urlPath = new URL(request.url, 'http://localhost').pathname;
        const filePath = urlPath === '/' ? '/index.html' : urlPath;
        const safePath = path.normalize(filePath).replace(/^(\.\.(\/|\\|$))+/, '');
        const fullPath = path.join(RENDER_PAGE_DIST, safePath);

        if (!fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) {
            return reply.code(404).send({ error: 'Not found' });
        }

        reply.header('Content-Type', getMimeType(fullPath));
        return reply.send(fs.createReadStream(fullPath));
    });

    // ── Serve media files directly (bypasses CDP serialization) ──

    const MEDIA_MIME_TYPES: Record<string, string> = {
        '.webm': 'video/webm',
        '.mp4': 'video/mp4',
        '.wav': 'audio/wav',
        '.mp3': 'audio/mpeg',
        '.aac': 'audio/aac',
    };

    app.get('/media/:jobId/:fileName', async (request, reply) => {
        const { jobId, fileName } = request.params as { jobId: string; fileName: string };
        const mediaDir = activeMediaDirs.get(jobId);
        if (!mediaDir) {
            return reply.code(404).send({ error: 'Unknown job' });
        }

        // Prevent path traversal
        const safeName = path.basename(fileName);
        const fullPath = path.join(mediaDir, safeName);

        if (!fs.existsSync(fullPath)) {
            return reply.code(404).send({ error: 'File not found' });
        }

        const ext = path.extname(safeName).toLowerCase();
        const contentType = MEDIA_MIME_TYPES[ext] ?? 'application/octet-stream';
        const stat = fs.statSync(fullPath);

        reply.header('Content-Type', contentType);
        reply.header('Content-Length', stat.size);
        return reply.send(fs.createReadStream(fullPath));
    });

    // ── Receive rendered MP4 from browser (bypasses CDP pipe) ─────
    // Stream directly to disk — skip Fastify body parsing to avoid
    // buffering the entire file in memory (crashes on >512MB).

    app.addContentTypeParser('video/mp4', (_req, _body, done) => {
        // Tell Fastify we handled it — body stays as the raw stream
        done(null, undefined);
    });

    app.put('/result/:jobId', async (request, reply) => {
        const { jobId } = request.params as { jobId: string };
        const pending = pendingResults.get(jobId);
        if (!pending) {
            return reply.code(404).send({ error: 'No pending result for job' });
        }

        const mediaDir = activeMediaDirs.get(jobId);
        if (!mediaDir) {
            return reply.code(404).send({ error: 'Unknown job' });
        }

        const filePath = path.join(mediaDir, 'result.mp4');

        // Stream the raw request body to disk
        const { pipeline } = await import('node:stream/promises');
        await pipeline(request.raw, fs.createWriteStream(filePath));

        const stat = fs.statSync(filePath);
        console.log(`[Render] Job ${jobId}: received result (${(stat.size / 1024 / 1024).toFixed(1)} MB)`);

        pending.resolve(filePath);
        pendingResults.delete(jobId);
        return reply.send({ ok: true });
    });

    // ── Render endpoint ───────────────────────────────────────────

    app.post('/render', async (request, reply) => {
        // Validate shared secret
        const authHeader = request.headers.authorization;
        if (authHeader !== `Bearer ${config.RENDER_SECRET}`) {
            return reply.code(401).send({ error: 'Unauthorized' });
        }

        const body = request.body as RenderBody;
        const { jobId, projectData, projectName, quality, mediaUrls, uploadUrl, statusCallbackUrl } = body;

        if (!jobId || !projectData || !quality || !uploadUrl || !statusCallbackUrl) {
            return reply.code(400).send({ error: 'Missing required fields' });
        }

        // Hold the connection open until the render is done (before upload).
        // This lets Cloud Run see the instance as busy and scale out for
        // concurrent requests instead of routing them to the same instance.
        const { renderDone } = runRender(jobId, projectData, projectName, quality, mediaUrls, uploadUrl, statusCallbackUrl);

        try {
            await renderDone;
        } catch {
            // Render failed — error is reported via status callback, not HTTP response.
            // Still return 200 so the edge function doesn't retry.
        }

        return reply.send({ ok: true, jobId });
    });

    return app;
}

// ── Track active job for crash reporting ─────────────────────
let activeJob: { jobId: string; statusCallbackUrl: string } | null = null;

process.on('uncaughtException', async (err) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[Render] Uncaught exception: ${message}`);
    const job = activeJob as { jobId: string; statusCallbackUrl: string } | null;
    if (job) {
        try {
            await updateJob(job.statusCallbackUrl, job.jobId, {
                status: 'failed',
                error: `Process crash: ${message}`,
            });
        } catch { /* best effort */ }
    }
    process.exit(1);
});

// ── Background render logic ───────────────────────────────────

export function runRender(
    jobId: string,
    projectData: unknown,
    projectName: string | undefined,
    quality: string,
    mediaUrls: MediaUrls,
    uploadUrl: string,
    statusCallbackUrl: string,
): { renderDone: Promise<void> } {
    let resolveRenderDone!: () => void;
    let rejectRenderDone!: (err: Error) => void;
    const renderDone = new Promise<void>((resolve, reject) => {
        resolveRenderDone = resolve;
        rejectRenderDone = reject;
    });

    _runRender(jobId, projectData, projectName, quality, mediaUrls, uploadUrl, statusCallbackUrl, resolveRenderDone, rejectRenderDone);

    return { renderDone };
}

async function _runRender(
    jobId: string,
    projectData: unknown,
    projectName: string | undefined,
    quality: string,
    mediaUrls: MediaUrls,
    uploadUrl: string,
    statusCallbackUrl: string,
    resolveRenderDone: () => void,
    rejectRenderDone: (err: Error) => void,
) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-'));
    console.log(`[Render] Job ${jobId}: starting in ${tmpDir}`);
    activeJob = { jobId, statusCallbackUrl };

    // Heartbeat — sends progress immediately on milestones, plus every 5s.
    let canceled = false;
    let currentProgress = 0;
    const durations: Record<string, number> = {};
    let phaseStart = Date.now();
    let heartbeatTimer: ReturnType<typeof setTimeout> | undefined;

    function sendHeartbeat() {
        updateJob(statusCallbackUrl, jobId, {
            progress: currentProgress,
            ...durations,
        }).then((shouldCancel) => {
            if (shouldCancel) {
                canceled = true;
                console.log(`[Render] Job ${jobId}: cancel signal received`);
            }
        }).catch(() => {});
    }

    function scheduleHeartbeat() {
        clearTimeout(heartbeatTimer);
        heartbeatTimer = setTimeout(() => {
            sendHeartbeat();
            scheduleHeartbeat();
        }, 5_000);
    }

    /** Send a heartbeat immediately and restart the 5s timer. */
    function milestone(progress: number) {
        currentProgress = progress;
        sendHeartbeat();
        scheduleHeartbeat();
    }

    function endPhase(durationKey: string) {
        durations[durationKey] = (Date.now() - phaseStart) / 1000;
        phaseStart = Date.now();
    }

    try {
        // 0% — job started
        milestone(0);

        // 1. Download media
        console.log(`[Render] Job ${jobId}: downloading`);
        const mediaFileNames = await downloadMedia(
            mediaUrls,
            projectData as any,
            tmpDir,
        );
        endPhase('download_duration_s');
        console.log(`[Render] Media downloaded: ${JSON.stringify(mediaFileNames)}`);

        if (canceled) throw new CancelError();

        // Download complete → 5%
        milestone(0.05);

        // Register media dir so Fastify can serve files directly to the browser
        // (bypasses Playwright CDP serialization which crashes on large files)
        activeMediaDirs.set(jobId, tmpDir);

        // 2. Wait for render slot (only one Playwright render at a time)
        console.log(`[Render] Job ${jobId}: waiting for render slot (queue: ${renderQueue.length})`);
        await acquireRenderSlot();
        console.log(`[Render] Job ${jobId}: rendering`);
        let renderDurationMs: number;
        try {
            const resultPromise = waitForResult(jobId);
            const result = await renderViaPlaywright({
                jobId,
                project: projectData,
                projectName,
                quality,
                mediaFileNames,
                mediaBaseUrl: `http://localhost:${config.PORT}/media/${jobId}/`,
                renderPageUrl: `http://localhost:${config.PORT}/`,
                resultUrl: `http://localhost:${config.PORT}/result/${jobId}`,
                uploadUrl,
                resultReady: resultPromise,
                onProgress: (progress) => {
                    if (progress !== currentProgress) {
                        milestone(progress);
                    }
                },
                onRenderDone: () => resolveRenderDone(),
            });

            // Upload happened inside renderViaPlaywright — subtract it from render time
            const totalPhaseMs = Date.now() - phaseStart;
            durations.render_duration_s = (totalPhaseMs - result.uploadDurationMs) / 1000;
            durations.upload_duration_s = result.uploadDurationMs / 1000;
            renderDurationMs = result.durationMs;
        } finally {
            releaseRenderSlot();
        }

        if (canceled) throw new CancelError();

        // 3. Done — 100%
        clearTimeout(heartbeatTimer);
        await updateJob(statusCallbackUrl, jobId, {
            status: 'completed',
            progress: 1.0,
            ...durations,
        });
        console.log(`[Render] Job ${jobId}: completed in ${(renderDurationMs / 1000).toFixed(1)}s`);

    } catch (err) {
        clearTimeout(heartbeatTimer);
        rejectRenderDone(err instanceof Error ? err : new Error(String(err)));
        if (err instanceof CancelError) {
            console.log(`[Render] Job ${jobId}: aborted (canceled)`);
        } else {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`[Render] Job ${jobId}: failed —`, message);
            await updateJob(statusCallbackUrl, jobId, { status: 'failed', error: message }).catch(() => {});
        }
    } finally {
        clearTimeout(heartbeatTimer);
        activeJob = null;
        activeMediaDirs.delete(jobId);
        // Clean up temp directory
        try {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch {
            console.warn(`[Render] Failed to clean up ${tmpDir}`);
        }
    }
}

class CancelError extends Error {
    constructor() { super('Job canceled'); }
}

// ── Job update helper ─────────────────────────────────────────

export async function updateJob(
    statusCallbackUrl: string,
    jobId: string,
    fields: { status?: string; progress?: number; error?: string },
): Promise<boolean> {
    const resp = await fetch(statusCallbackUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.RENDER_SECRET}`,
        },
        body: JSON.stringify({ jobId, ...fields }),
    });

    if (!resp.ok) {
        console.error(`[Render] Status callback failed: ${resp.status}`);
        return false;
    }

    const data = await resp.json() as { ok: boolean; cancel: boolean };
    return data.cancel;
}

// ── Start server (only when run directly, not imported by tests) ─

const isDirectRun = process.argv[1]?.endsWith('server.ts') ||
    process.argv[1]?.endsWith('server.js');

if (isDirectRun) {
    const app = createApp();
    try {
        await warmBrowser();
        await app.listen({ port: config.PORT, host: '0.0.0.0' });
        app.log.info(`Render worker listening on port ${config.PORT}`);
    } catch (err) {
        app.log.error(err);
        process.exit(1);
    }
}
