/**
 * Render worker Fastify server.
 *
 * Deployed on Fly.io. Receives render jobs from the render-start-job edge
 * function with signed URLs for media download/upload. Has zero Supabase
 * credentials — reports status via HTTP callback to render-update-status.
 */

import Fastify from 'fastify';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { config } from './config.js';
import { downloadMedia, type MediaUrls } from './downloadMedia.js';
import { renderViaPlaywright } from './playwrightRender.js';
import { uploadResult } from './uploadResult.js';

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

interface RenderBody {
    jobId: string;
    projectData: unknown;
    quality: string;
    mediaUrls: MediaUrls;
    uploadUrl: string;
    statusCallbackUrl: string;
}

app.post('/render', async (request, reply) => {
    // Validate shared secret
    const authHeader = request.headers.authorization;
    if (authHeader !== `Bearer ${config.RENDER_SECRET}`) {
        return reply.code(401).send({ error: 'Unauthorized' });
    }

    const body = request.body as RenderBody;
    const { jobId, projectData, quality, mediaUrls, uploadUrl, statusCallbackUrl } = body;

    if (!jobId || !projectData || !quality || !uploadUrl || !statusCallbackUrl) {
        return reply.code(400).send({ error: 'Missing required fields' });
    }

    // Respond immediately — render continues in background
    reply.send({ ok: true, jobId });

    // Run render in background (don't await in handler)
    runRender(jobId, projectData, quality, mediaUrls, uploadUrl, statusCallbackUrl)
        .catch(err => {
            console.error(`[Render] Unhandled error in background render:`, err);
        });
});

// ── Background render logic ───────────────────────────────────

async function runRender(
    jobId: string,
    projectData: unknown,
    quality: string,
    mediaUrls: MediaUrls,
    uploadUrl: string,
    statusCallbackUrl: string,
) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-'));
    console.log(`[Render] Job ${jobId}: starting in ${tmpDir}`);

    // Start heartbeat — reports progress every 15s, checks for cancel
    let canceled = false;
    let currentProgress = 0;
    const heartbeatInterval = setInterval(async () => {
        try {
            const shouldCancel = await updateJob(statusCallbackUrl, jobId, { progress: currentProgress });
            if (shouldCancel) {
                canceled = true;
                console.log(`[Render] Job ${jobId}: cancel signal received`);
            }
        } catch (err) {
            console.warn(`[Render] Heartbeat failed for ${jobId}:`, err);
        }
    }, 15_000);

    try {
        // 1. Download media
        currentProgress = 0;
        const mediaFileNames = await downloadMedia(
            mediaUrls,
            projectData as any,
            tmpDir,
        );
        console.log(`[Render] Media downloaded: ${JSON.stringify(mediaFileNames)}`);

        if (canceled) throw new CancelError();

        // 2. Render via Playwright
        currentProgress = 0.2;
        const result = await renderViaPlaywright({
            project: projectData,
            quality,
            mediaDir: tmpDir,
            mediaFileNames,
            onProgress: (phase, progress, message) => {
                console.log(`[Render] [${phase}] ${(progress * 100).toFixed(1)}% — ${message}`);
                // Map render progress to 0.2–0.8 range
                currentProgress = 0.2 + progress * 0.6;
            },
        });

        if (canceled) throw new CancelError();

        // 3. Upload result via signed URL PUT
        currentProgress = 0.85;
        console.log(`[Render] Uploading ${result.outputPath}`);
        await uploadResult(result.outputPath, uploadUrl, (fraction) => {
            currentProgress = 0.85 + fraction * 0.15;
        });

        if (canceled) throw new CancelError();

        // 4. Done
        clearInterval(heartbeatInterval);
        await updateJob(statusCallbackUrl, jobId, { status: 'completed', progress: 1 });
        console.log(`[Render] Job ${jobId}: completed in ${(result.durationMs / 1000).toFixed(1)}s`);

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

async function updateJob(
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

// ── Start server ──────────────────────────────────────────────

try {
    await app.listen({ port: config.PORT, host: '0.0.0.0' });
    app.log.info(`Render worker listening on port ${config.PORT}`);
} catch (err) {
    app.log.error(err);
    process.exit(1);
}
