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
import { renderViaPlaywright, warmBrowser } from './playwrightRender.js';

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
        logger: {
            level: 'info',
            transport: process.env.NODE_ENV !== 'production'
                ? { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss' } }
                : undefined,
        },
    });

    // ── Health check ──────────────────────────────────────────────

    app.get('/health', async () => ({ status: 'ok' }));

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

        // Accept immediately — render runs in the background.
        // Downloads overlap across jobs; Playwright renders are serialized.
        runRender(jobId, projectData, projectName, quality, mediaUrls, uploadUrl, statusCallbackUrl);

        return reply.send({ ok: true, jobId });
    });

    return app;
}

// ── Background render logic ───────────────────────────────────

export async function runRender(
    jobId: string,
    projectData: unknown,
    projectName: string | undefined,
    quality: string,
    mediaUrls: MediaUrls,
    uploadUrl: string,
    statusCallbackUrl: string,
) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-'));
    console.log(`[Render] Job ${jobId}: starting in ${tmpDir}`);

    // Heartbeat — reports progress + durations every 15s, checks for cancel.
    let canceled = false;
    let currentProgress = 0;
    const durations: Record<string, number> = {};
    let phaseStart = Date.now();

    const heartbeatInterval = setInterval(() => {
        updateJob(statusCallbackUrl, jobId, {
            progress: currentProgress,
            ...durations,
        }).then((shouldCancel) => {
            if (shouldCancel) {
                canceled = true;
                console.log(`[Render] Job ${jobId}: cancel signal received`);
            }
        }).catch(() => {});
    }, 5_000);

    function endPhase(durationKey: string) {
        durations[durationKey] = (Date.now() - phaseStart) / 1000;
        phaseStart = Date.now();
    }

    try {
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

        // 2. Wait for render slot (only one Playwright render at a time)
        console.log(`[Render] Job ${jobId}: waiting for render slot (queue: ${renderQueue.length})`);
        await acquireRenderSlot();
        console.log(`[Render] Job ${jobId}: rendering`);
        let renderDurationMs: number;
        try {
            const result = await renderViaPlaywright({
                jobId,
                project: projectData,
                projectName,
                quality,
                mediaFileNames,
                mediaDir: tmpDir,
                uploadUrl,
                onProgress: (phase, progress, message) => {
                    console.log(`[Render] [${phase}] ${(progress * 100).toFixed(1)}% — ${message}`);
                    currentProgress = progress;
                },
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

        // 4. Done
        clearInterval(heartbeatInterval);
        await updateJob(statusCallbackUrl, jobId, {
            status: 'completed',
            ...durations,
        });
        console.log(`[Render] Job ${jobId}: completed in ${(renderDurationMs / 1000).toFixed(1)}s`);

    } catch (err) {
        clearInterval(heartbeatInterval);
        if (err instanceof CancelError) {
            console.log(`[Render] Job ${jobId}: aborted (canceled)`);
        } else {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`[Render] Job ${jobId}: failed —`, message);
            await updateJob(statusCallbackUrl, jobId, { status: 'failed', error: message }).catch(() => {});
        }
    } finally {
        clearInterval(heartbeatInterval);
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
