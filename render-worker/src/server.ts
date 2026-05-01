/**
 * Render worker Fastify server.
 *
 * Deployed on Google Cloud Run. Receives render jobs from the render-sync
 * edge function with signed URLs for media download/upload. Has zero Supabase
 * credentials — reports status via HTTP callback to render-job-hook.
 */

import Fastify from 'fastify';
import * as http from 'node:http';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { config } from './config.js';
import { downloadMedia, type MediaUrls } from './downloadMedia.js';
import { renderViaPlaywright, warmBrowser } from './playwrightRender.js';


// ── Media file server (port 9998) ────────────────────────────
// Serves media files over real HTTP to avoid CDP base64 overhead
// that kills the browser for large files (100MB+).
// Each job registers its temp dir under /jobId/filename.

const MIME_TYPES: Record<string, string> = {
    '.webm': 'video/webm', '.mp4': 'video/mp4', '.wav': 'audio/wav',
    '.mp3': 'audio/mpeg', '.aac': 'audio/aac', '.ogg': 'audio/ogg',
    '.avif': 'image/avif', '.webp': 'image/webp', '.png': 'image/png',
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
};

export const mediaJobDirs = new Map<string, string>();

const mediaServer = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    // URL format: /{jobId}/{filename}
    const parts = url.pathname.slice(1).split('/');
    if (parts.length < 2) {
        res.writeHead(400);
        res.end('Bad request');
        return;
    }
    const [jobId, ...rest] = parts;
    const fileName = rest.join('/');
    const dir = mediaJobDirs.get(jobId);
    if (!dir) {
        res.writeHead(404);
        res.end('Unknown job');
        return;
    }
    const filePath = path.join(dir, fileName);

    // PUT = upload file from browser (used for MP4 result extraction)
    if (req.method === 'PUT') {
        const writeStream = fs.createWriteStream(filePath);
        req.pipe(writeStream);
        writeStream.on('finish', () => {
            res.writeHead(200);
            res.end('ok');
        });
        writeStream.on('error', (err) => {
            console.error(`[Media] Write error: ${err.message}`);
            res.writeHead(500);
            res.end('Write failed');
        });
        return;
    }

    if (!fs.existsSync(filePath)) {
        res.writeHead(404);
        res.end('Not found');
        return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';
    const stat = fs.statSync(filePath);
    res.writeHead(200, { 'Content-Type': contentType, 'Content-Length': stat.size });
    fs.createReadStream(filePath).pipe(res);
});

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
    projectName?: string;
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
    const { jobId, projectData, projectName, quality, mediaUrls, uploadUrl, statusCallbackUrl } = body;

    if (!jobId || !projectData || !quality || !uploadUrl || !statusCallbackUrl) {
        return reply.code(400).send({ error: 'Missing required fields' });
    }

    // Render synchronously — with Cloud Run --concurrency=1, no second
    // job lands on this instance while we're busy.
    await runRender(jobId, projectData, projectName, quality, mediaUrls, uploadUrl, statusCallbackUrl);

    return reply.send({ ok: true, jobId });
});

// ── Background render logic ───────────────────────────────────

async function runRender(
    jobId: string,
    projectData: unknown,
    projectName: string | undefined,
    quality: string,
    mediaUrls: MediaUrls,
    uploadUrl: string,
    statusCallbackUrl: string,
) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-'));
    mediaJobDirs.set(jobId, tmpDir);
    console.log(`[Render] Job ${jobId}: starting in ${tmpDir}`);

    // Heartbeat — reports progress + durations every 15s, checks for cancel.
    let canceled = false;
    let currentProgress = 0;
    const durations: Record<string, number> = {};
    let phaseStart = Date.now();

    const heartbeatInterval = setInterval(async () => {
        try {
            const shouldCancel = await updateJob(statusCallbackUrl, jobId, {
                progress: currentProgress,
                ...durations,
            });
            if (shouldCancel) {
                canceled = true;
                console.log(`[Render] Job ${jobId}: cancel signal received`);
            }
        } catch (err) {
            console.warn(`[Render] Heartbeat failed for ${jobId}:`, err);
        }
    }, 15_000);

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

        // 2. Render via Playwright (progress tracks export: 0–1)
        console.log(`[Render] Job ${jobId}: rendering`);
        const result = await renderViaPlaywright({
            jobId,
            project: projectData,
            projectName,
            quality,
            mediaFileNames,
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

        if (canceled) throw new CancelError();

        // 4. Done
        clearInterval(heartbeatInterval);
        await updateJob(statusCallbackUrl, jobId, {
            status: 'completed',
            ...durations,
        });
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
        mediaJobDirs.delete(jobId);
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
    // Start media file server on port 9998 (serves large files via real HTTP, not CDP)
    mediaServer.listen(9998, '127.0.0.1', () => {
        console.log('[Media] Media file server listening on port 9998');
    });
    // Pre-launch Chromium so the ~26s cold start is paid once at boot
    await warmBrowser();
    await app.listen({ port: config.PORT, host: '0.0.0.0' });
    app.log.info(`Render worker listening on port ${config.PORT}`);
} catch (err) {
    app.log.error(err);
    process.exit(1);
}
