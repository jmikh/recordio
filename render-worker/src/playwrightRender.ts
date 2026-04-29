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
 * File serving is done via Playwright route interception — no need for a
 * separate HTTP server.
 */

import { chromium, type Browser, type Page } from 'playwright';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

import type { MediaFileNames } from './downloadMedia.js';

export interface PlaywrightRenderConfig {
    jobId: string;
    project: unknown;
    projectName?: string;
    quality: string;
    mediaDir: string;
    /** storagePath → local filename */
    mediaFileNames: MediaFileNames;
    /** Signed URL for direct upload from browser. If provided, skips disk write. */
    uploadUrl?: string;
    onProgress?: (phase: string, progress: number, message: string) => void;
}

export interface RenderResult {
    /** Path to the rendered MP4. Null when uploaded directly from browser. */
    outputPath: string | null;
    durationMs: number;
    /** Size in bytes of the rendered file. */
    sizeBytes: number;
}

// In production (Docker): render-page/dist is at ../render-page/dist relative to dist/
// In dev (tsx): render-page/dist is at ./render-page/dist relative to src/
const RENDER_PAGE_DIST = process.env.RENDER_PAGE_DIST
    ?? path.resolve(import.meta.dirname, '../render-page/dist');

const MIME_TYPES: Record<string, string> = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.wasm': 'application/wasm',
    '.webm': 'video/webm',
    '.mp4': 'video/mp4',
    '.wav': 'audio/wav',
    '.mp3': 'audio/mpeg',
    '.aac': 'audio/aac',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.webp': 'image/webp',
    '.avif': 'image/avif',
    '.json': 'application/json',
};

function getMimeType(filePath: string): string {
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
    // Log GPU driver visibility
    const nvidiaPath = '/usr/local/nvidia/lib64';
    console.log(`[Render] NVIDIA driver path exists: ${fs.existsSync(nvidiaPath)}`);
    if (fs.existsSync(nvidiaPath)) {
        const allLibs = fs.readdirSync(nvidiaPath);
        console.log(`[Render] NVIDIA libs (${allLibs.length} files): ${allLibs.filter(f => f.includes('vulkan') || f.includes('EGL') || f.includes('nvidia')).join(', ')}`);
    }
    console.log(`[Render] LD_LIBRARY_PATH: ${process.env.LD_LIBRARY_PATH ?? '(unset)'}`);

    // Log ICD discovery files
    const eglVendorDir = '/usr/share/glvnd/egl_vendor.d';
    const vulkanIcdDir = '/usr/share/vulkan/icd.d';
    console.log(`[Render] EGL vendor configs: ${fs.existsSync(eglVendorDir) ? fs.readdirSync(eglVendorDir).join(', ') : '(dir missing)'}`);
    console.log(`[Render] Vulkan ICD configs: ${fs.existsSync(vulkanIcdDir) ? fs.readdirSync(vulkanIcdDir).join(', ') : '(dir missing)'}`);

    const start = Date.now();
    console.log('[Render] Pre-launching Chromium...');
    _browser = await launchBrowser();
    console.log(`[Render] Chromium ready in ${((Date.now() - start) / 1000).toFixed(1)}s`);

    // Run nvidia-smi to check GPU visibility at OS level
    try {
        const smi = execSync('nvidia-smi --query-gpu=name,driver_version,memory.total --format=csv,noheader', { timeout: 5000 }).toString().trim();
        console.log(`[Render] nvidia-smi: ${smi}`);
    } catch (e) {
        console.warn(`[Render] nvidia-smi failed (GPU not visible at OS level): ${e}`);
    }

    // Check NVIDIA device nodes
    for (const dev of ['/dev/nvidia0', '/dev/nvidiactl', '/dev/nvidia-uvm']) {
        console.log(`[Render] ${dev}: ${fs.existsSync(dev) ? 'EXISTS' : 'MISSING'}`);
    }

    // Check Vulkan device visibility with loader debug
    try {
        const vkInfo = execSync('VK_LOADER_DEBUG=error vulkaninfo --summary 2>&1 | head -50', { timeout: 10000 }).toString().trim();
        console.log(`[Render] vulkaninfo: ${vkInfo}`);
    } catch (e) {
        console.warn(`[Render] vulkaninfo failed: ${e}`);
    }

    // Check DRM render nodes — Chrome needs /dev/dri/renderD* for GPU access
    try {
        const driPath = '/dev/dri';
        if (fs.existsSync(driPath)) {
            const devices = fs.readdirSync(driPath);
            console.log(`[Render] /dev/dri/ devices: ${devices.join(', ')}`);
        } else {
            console.warn(`[Render] /dev/dri/ missing — attempting to create render node...`);
            // Try loading nvidia-drm module and creating device nodes
            try {
                execSync('modprobe nvidia-drm 2>&1 || true', { timeout: 5000 });
                console.log(`[Render] modprobe nvidia-drm attempted`);
            } catch { /* may not have permission */ }
            try {
                // nvidia-smi can trigger device node creation
                execSync('nvidia-smi -q -d DISPLAY 2>&1 | head -5', { timeout: 5000 });
            } catch { /* ignore */ }
            try {
                // Try mknod as fallback — renderD128 is major 226, minor 128
                execSync('mkdir -p /dev/dri && mknod /dev/dri/renderD128 c 226 128 && chmod 666 /dev/dri/renderD128', { timeout: 5000 });
                console.log(`[Render] Created /dev/dri/renderD128 manually`);
            } catch (e2) {
                console.warn(`[Render] Failed to create DRM device: ${e2}`);
            }
            // Check again
            if (fs.existsSync(driPath)) {
                console.log(`[Render] /dev/dri/ now has: ${fs.readdirSync(driPath).join(', ')}`);
            } else {
                console.error(`[Render] /dev/dri/ STILL missing — GPU rendering unavailable`);
            }
        }
    } catch (e) {
        console.warn(`[Render] DRM device check failed: ${e}`);
    }
}

async function launchBrowser(): Promise<Browser> {
    return chromium.launch({
        headless: false,
        args: [
            '--headless=new',
            '--use-angle=vulkan',
            '--enable-features=Vulkan',
            '--disable-vulkan-surface',
            '--enable-gpu-rasterization',
            '--ignore-gpu-blocklist',
            '--disable-gpu-sandbox',
            '--in-process-gpu',
            '--disable-web-security',
            '--autoplay-policy=no-user-gesture-required',
            '--no-sandbox',
            '--enable-logging=stderr',
            '--vmodule=gpu*=1,*angle*=1,*vulkan*=1',
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
    const { jobId, project, projectName, quality, mediaDir, mediaFileNames, uploadUrl, onProgress } = config;
    const log = onProgress ?? ((phase: string, _p: number, msg: string) => console.log(`[Render] [${phase}] ${msg}`));
    const startTime = Date.now();

    const browser = await getBrowser();
    const page: Page = await browser.newPage();
    let intentionalClose = false;

    try {
        // --- Intercept requests to serve files locally ---
        // localhost URLs = secure context (required for crypto.randomUUID, WebCodecs)

        // Serve render page files at http://localhost:9999/*
        await page.route('http://localhost:9999/**', async (route) => {
            const url = new URL(route.request().url());
            const filePath = url.pathname === '/' ? '/index.html' : url.pathname;
            const fullPath = path.join(RENDER_PAGE_DIST, filePath);

            if (fs.existsSync(fullPath)) {
                const body = fs.readFileSync(fullPath);
                await route.fulfill({
                    status: 200,
                    contentType: getMimeType(fullPath),
                    body,
                });
            } else {
                console.warn(`[Render] 404: ${fullPath}`);
                await route.fulfill({ status: 404, body: 'Not found' });
            }
        });

        // Media files are served by the real HTTP server on port 9998 (see server.ts)
        // This avoids CDP base64 overhead that kills the browser for large files.

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

        page.on('crash', () => {
            console.error(`[Render][browser] PAGE CRASHED`);
        });

        page.on('close', () => {
            if (!intentionalClose) {
                console.error(`[Render][browser] Page closed unexpectedly`);
            }
        });

        // --- Inject job config before page loads ---
        const mediaBaseUrl = `http://localhost:9998/${jobId}/`;
        const renderJob = { project, projectName, quality, mediaBaseUrl, mediaFileNames };

        await page.addInitScript((job: any) => {
            (window as any).__RENDER_JOB__ = job;
        }, renderJob);

        log('prepare', 0.3, 'Navigating to render page...');
        await page.goto('http://localhost:9999/', {
            waitUntil: 'domcontentloaded',
            timeout: 30_000,
        });

        // --- GPU diagnostic ---
        const gpuInfo = await page.evaluate(() => {
            const canvas = document.createElement('canvas');
            const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
            const debugInfo = gl?.getExtension('WEBGL_debug_renderer_info');
            const renderer = debugInfo ? gl!.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : 'unknown';
            const vendor = debugInfo ? gl!.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) : 'unknown';

            // Check if 2D canvas is accelerated
            const c2d = document.createElement('canvas');
            const ctx = c2d.getContext('2d');
            const attrs = (ctx as any)?.getContextAttributes?.();

            return {
                renderer,
                vendor,
                canvas2dAccelerated: attrs?.willReadFrequently === false,
                canvas2dAttrs: JSON.stringify(attrs ?? {}),
                hardwareConcurrency: navigator.hardwareConcurrency,
            };
        });
        console.log(`[Render] GPU info:`, JSON.stringify(gpuInfo));

        log('render', 0, 'Render page loaded, waiting for export to complete...');

        // --- Wait for render to finish with stale progress detection ---
        // Instead of a fixed timeout, we check if progress has stalled for 30s.
        const STALE_TIMEOUT_MS = 30_000;
        let lastProgress = -1;
        let lastProgressTime = Date.now();

        await new Promise<void>((resolve, reject) => {
            const pollInterval = setInterval(async () => {
                try {
                    const state = await page.evaluate(() => ({
                        done: (window as any).__RENDER_DONE__ === true,
                        progress: (window as any).__RENDER_PROGRESS__ as number | undefined,
                        status: document.getElementById('status')?.textContent ?? '',
                    }));

                    if (state.done) {
                        clearInterval(pollInterval);
                        resolve();
                        return;
                    }

                    if (state.status) {
                        log('render', state.progress ?? 0, `Page status: ${state.status}`);
                    }

                    // Check for stale progress
                    const currentProgress = state.progress ?? 0;
                    if (currentProgress > lastProgress) {
                        lastProgress = currentProgress;
                        lastProgressTime = Date.now();
                    } else if (Date.now() - lastProgressTime > STALE_TIMEOUT_MS) {
                        clearInterval(pollInterval);
                        reject(new Error(
                            `Export stalled — no progress for ${STALE_TIMEOUT_MS / 1000}s ` +
                            `(last progress: ${(lastProgress * 100).toFixed(1)}%, status: "${state.status}")`
                        ));
                    }
                } catch {
                    // page may be navigating or crashed — stale timer still ticking
                }
            }, 2000);
        });

        // --- Check for errors ---
        const error = await page.evaluate(() => (window as any).__RENDER_ERROR__);
        if (error) {
            throw new Error(`Render page error: ${error}`);
        }

        // --- Upload result ---
        if (uploadUrl) {
            // Direct upload from browser to signed URL — skips disk write + re-upload
            log('finalize', 0.8, 'Uploading MP4 directly from browser...');
            const sizeBytes = await page.evaluate(async (url: string) => {
                const ab = (globalThis as any).__RENDER_RESULT__ as ArrayBuffer;
                const resp = await fetch(url, {
                    method: 'PUT',
                    body: ab,
                    headers: {
                        'Content-Type': 'video/mp4',
                        'x-upsert': 'true',
                    },
                });
                if (!resp.ok) throw new Error(`Upload failed: ${resp.status} ${await resp.text()}`);
                return ab.byteLength;
            }, uploadUrl);

            const durationMs = Date.now() - startTime;
            const sizeMB = (sizeBytes / 1024 / 1024).toFixed(2);
            log('finalize', 1, `Done! ${sizeMB} MB uploaded directly in ${(durationMs / 1000).toFixed(1)}s`);

            return { outputPath: null, durationMs, sizeBytes };
        } else {
            // Fallback: extract to disk via local media server
            log('finalize', 0.8, 'Extracting MP4 from browser...');
            const outputPath = path.join(mediaDir, 'output.mp4');

            await page.evaluate(async (localUrl: string) => {
                const ab = (globalThis as any).__RENDER_RESULT__ as ArrayBuffer;
                const resp = await fetch(localUrl, {
                    method: 'PUT',
                    body: ab,
                    headers: { 'Content-Type': 'application/octet-stream' },
                });
                if (!resp.ok) throw new Error(`Upload failed: ${resp.status}`);
            }, `http://localhost:9998/${jobId}/output.mp4`);

            const stat = fs.statSync(outputPath);
            const durationMs = Date.now() - startTime;
            const sizeMB = (stat.size / 1024 / 1024).toFixed(2);
            log('finalize', 1, `Done! ${sizeMB} MB written to ${outputPath} in ${(durationMs / 1000).toFixed(1)}s`);

            return { outputPath, durationMs, sizeBytes: stat.size };
        }

    } finally {
        intentionalClose = true;
        await page.close();
    }
}
