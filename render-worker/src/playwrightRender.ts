/**
 * Headless browser render orchestrator.
 *
 * Pre-launches Playwright Chromium at server startup so the ~26s cold start
 * is paid once, not per job. Each render creates a fresh page (isolated context)
 * on the shared browser instance.
 *
 * The render page runs the exact same ExportManager pipeline as the browser,
 * using WebCodecs for fast hardware/software video encoding.
 *
 * Only the render-page static assets (html/js/css/wasm) are served via Playwright
 * route interception. Media files and result MP4s go through Fastify HTTP to
 * bypass CDP serialization limits (see CLAUDE.md).
 */

import { chromium, type Browser, type Page } from 'playwright';
import * as fs from 'node:fs';
import * as path from 'node:path';

import type { MediaFileNames } from './downloadMedia.js';
// GPU diagnostics available but not called at startup — enable for debugging:
// import { logGpuDiagnostics, logBrowserGpuInfo } from './gpuDiagnostics.js';

export interface PlaywrightRenderConfig {
    jobId: string;
    project: unknown;
    projectName?: string;
    quality: string;
    /** storagePath → local filename */
    mediaFileNames: MediaFileNames;
    /** Base URL for media files served by Fastify (e.g. http://localhost:8080/media/jobId/) */
    mediaBaseUrl: string;
    /** URL for the render page served by Fastify (e.g. http://localhost:8080/render-page/) */
    renderPageUrl: string;
    /** URL where the render page POSTs the result MP4 (Fastify endpoint, bypasses CDP) */
    resultUrl: string;
    /** Signed URL for upload to storage (Node uploads from disk after receiving result) */
    uploadUrl: string;
    /** Promise that resolves with the result file path once the render page POSTs it */
    resultReady: Promise<string>;
    /** Called with monotonic progress 0→1: download=0→0.05, export=0.10→0.95, upload=0.95→1.0 */
    onProgress?: (progress: number) => void;
    /** Called when the render is complete (before upload). Used to release the HTTP connection. */
    onRenderDone?: () => void;
}

export interface RenderResult {
    durationMs: number;
    sizeBytes: number;
    uploadDurationMs: number;
}

// In production (Docker): render-page/dist is at ../render-page/dist relative to dist/
// In dev (tsx): render-page/dist is at ./render-page/dist relative to src/
export const RENDER_PAGE_DIST = process.env.RENDER_PAGE_DIST
    ?? path.resolve(import.meta.dirname, '../render-page/dist');

// Only types needed for render-page static assets (media served by Fastify)
const MIME_TYPES: Record<string, string> = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.wasm': 'application/wasm',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.json': 'application/json',
};

export function getMimeType(filePath: string): string {
    return MIME_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

// ── Shared browser instance ──────────────────────────────────

let _browser: Browser | null = null;
let _browserLaunching: Promise<Browser> | null = null;

/**
 * Pre-launch Chromium at server startup. Call this once from server.ts.
 * The browser stays alive for the lifetime of the process.
 */
export async function warmBrowser(): Promise<void> {
    const start = Date.now();
    console.log('[Render] Pre-launching Chromium...');
    _browser = await launchBrowser();
    console.log(`[Render] Chromium ready in ${((Date.now() - start) / 1000).toFixed(1)}s`);
}

async function launchBrowser(): Promise<Browser> {
    const isLinux = process.platform === 'linux';
    const gpuArgs = isLinux
        ? [
            '--use-angle=vulkan',
            '--enable-features=Vulkan,VaapiVideoEncoder,VaapiVideoEncodeAcceleration,VaapiIgnoreDriverChecks',
            '--disable-vulkan-surface',
            '--enable-gpu-rasterization',
            '--ignore-gpu-blocklist',
            '--disable-gpu-sandbox',
            '--in-process-gpu',
            '--enable-logging=stderr',
            '--vmodule=gpu*=1,*angle*=1,*vulkan*=1,*vaapi*=1,*video_encode*=1',
        ]
        : [
            '--use-angle=metal',
            '--enable-gpu-rasterization',
        ];

    return chromium.launch({
        headless: false,
        args: [
            '--headless=new',
            ...gpuArgs,
            '--disable-web-security',
            '--autoplay-policy=no-user-gesture-required',
            '--no-sandbox',
        ],
    });
}

async function getBrowser(): Promise<Browser> {
    if (_browser?.isConnected()) return _browser;

    // Avoid double-launching if two jobs arrive at once
    if (_browserLaunching) return _browserLaunching;

    console.warn('[Render] Browser not available — launching on demand...');
    _browserLaunching = launchBrowser();
    _browser = await _browserLaunching;
    _browserLaunching = null;
    return _browser;
}

// ── Render function ──────────────────────────────────────────

export async function renderViaPlaywright(config: PlaywrightRenderConfig): Promise<RenderResult> {
    const { project, projectName, quality, mediaFileNames, mediaBaseUrl, renderPageUrl, resultUrl, uploadUrl, resultReady, onProgress, onRenderDone } = config;
    const reportProgress = onProgress ?? (() => {});
    const startTime = Date.now();

    const browser = await getBrowser();
    const page: Page = await browser.newPage();
    let intentionalClose = false;

    try {
        // Render-page static files and media are both served by Fastify.
        // No Playwright route interception — this keeps CDP Fetch disabled,
        // so the large result MP4 POST doesn't get serialized through the pipe.

        // Track failed requests so broken assets fail the job
        const failedRequests: string[] = [];

        page.on('requestfailed', request => {
            const url = request.url();
            const failure = request.failure()?.errorText ?? 'unknown';
            console.error(`[Render][browser] Request failed: ${url} (${failure})`);
            failedRequests.push(`${url} (${failure})`);
        });

        page.on('response', response => {
            if (response.status() >= 400) {
                const url = response.url();
                console.error(`[Render][browser] HTTP ${response.status()}: ${url}`);
                failedRequests.push(`${url} (HTTP ${response.status()})`);
            }
        });

        // Forward browser console to worker console
        page.on('console', msg => {
            const type = msg.type();
            const text = msg.text();
            if (type === 'error') {
                console.error(`[Render][browser] ${text}`);
            } else {
                console.log(`[Render][browser] ${text}`);
            }
        });

        page.on('pageerror', err => {
            console.error(`[Render][browser] Page error:`, err.message);
        });

        let pageDead: Error | null = null;

        page.on('crash', () => {
            console.error(`[Render][browser] PAGE CRASHED`);
            pageDead = new Error('Browser page crashed (likely OOM)');
        });

        page.on('close', () => {
            if (!intentionalClose) {
                console.error(`[Render][browser] Page closed unexpectedly`);
                pageDead = new Error('Browser page closed unexpectedly');
            }
        });

        // --- Inject job config before page loads ---
        const renderJob = { project, projectName, quality, mediaBaseUrl, mediaFileNames, resultUrl };

        await page.addInitScript((job: any) => {
            (window as any).__RENDER_JOB__ = job;
        }, renderJob);

        console.log('[Render] Navigating to render page...');
        await page.goto(renderPageUrl, {
            waitUntil: 'networkidle',
            timeout: 30_000,
        });

        if (failedRequests.length > 0) {
            throw new Error(`Render page failed to load resources:\n${failedRequests.join('\n')}`);
        }

        console.log('[Render] Render page loaded, waiting for export...');

        // --- Wait for render to finish with stale progress detection ---
        // Progress: 10% (first frame) → 95% (all frames done)
        // Stall = no frame count change for 30s once exporting has started.
        const STALE_TIMEOUT_MS = 30_000;
        let lastFramesDone = -1;
        let lastFrameChangeTime = Date.now();

        await new Promise<void>((resolve, reject) => {
            const pollInterval = setInterval(async () => {
                if (pageDead) {
                    clearInterval(pollInterval);
                    reject(pageDead);
                    return;
                }

                try {
                    const state = await page.evaluate(() => ({
                        done: (window as any).__RENDER_DONE__ === true,
                        error: (window as any).__RENDER_ERROR__ as string | undefined,
                        framesDone: (window as any).__RENDER_FRAMES_DONE__ as number | undefined,
                        framesTotal: (window as any).__RENDER_FRAMES_TOTAL__ as number | undefined,
                    }));

                    if (state.error) {
                        clearInterval(pollInterval);
                        reject(new Error(`Render page error: ${state.error}`));
                        return;
                    }

                    if (state.done) {
                        clearInterval(pollInterval);
                        resolve();
                        return;
                    }

                    // Compute and report progress from frame counts (10% → 95%)
                    if (state.framesDone != null && state.framesTotal != null && state.framesTotal > 0) {
                        const progress = 0.10 + (state.framesDone / state.framesTotal) * 0.85;
                        reportProgress(progress);
                        console.log(`[Render] Exporting: ${state.framesDone}/${state.framesTotal} frames (${(progress * 100).toFixed(1)}%)`);

                        // Stall detection — only once exporting has started
                        if (state.framesDone > lastFramesDone) {
                            lastFramesDone = state.framesDone;
                            lastFrameChangeTime = Date.now();
                        } else if (Date.now() - lastFrameChangeTime > STALE_TIMEOUT_MS) {
                            clearInterval(pollInterval);
                            reject(new Error(
                                `Export stalled — no frame progress for ${STALE_TIMEOUT_MS / 1000}s ` +
                                `(frames: ${state.framesDone}/${state.framesTotal})`
                            ));
                        }
                    }
                } catch {
                    // page.evaluate throws on dead page — pageDead will be set next tick
                }
            }, 2000);
        });

        // --- Upload ---
        // Wait for the render page to POST the result MP4 to Fastify.
        // This bypasses CDP entirely — the browser sends directly to localhost.
        reportProgress(0.95);
        console.log('[Render] Waiting for result from browser...');
        const resultFilePath = await resultReady;
        const stat = fs.statSync(resultFilePath);
        console.log(`[Render] Result received: ${(stat.size / 1024 / 1024).toFixed(1)} MB`);

        // Render done — signal before upload so the HTTP connection can close
        onRenderDone?.();

        // Upload from disk to signed storage URL (Node-side, no CDP)
        console.log('[Render] Uploading MP4 to storage...');
        const uploadStart = Date.now();
        const resp = await fetch(uploadUrl, {
            method: 'PUT',
            body: fs.createReadStream(resultFilePath),
            headers: {
                'Content-Type': 'video/mp4',
                'Content-Length': String(stat.size),
                'x-upsert': 'true',
            },
            duplex: 'half',
        } as RequestInit);
        if (!resp.ok) throw new Error(`Upload failed: ${resp.status} ${await resp.text()}`);
        const sizeBytes = stat.size;
        const uploadDurationMs = Date.now() - uploadStart;

        reportProgress(1.0);
        const durationMs = Date.now() - startTime;
        const sizeMB = (sizeBytes / 1024 / 1024).toFixed(2);
        console.log(`[Render] Done! ${sizeMB} MB uploaded in ${(durationMs / 1000).toFixed(1)}s`);

        return { durationMs, sizeBytes, uploadDurationMs };

    } finally {
        intentionalClose = true;
        await page.close();
    }
}
