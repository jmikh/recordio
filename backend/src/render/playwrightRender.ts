/**
 * Headless browser render orchestrator.
 *
 * Launches Playwright Chromium, navigates to the self-contained render page,
 * injects the job config, and extracts the resulting MP4 ArrayBuffer.
 *
 * The render page runs the exact same ExportManager pipeline as the browser,
 * using WebCodecs for fast hardware/software video encoding.
 *
 * File serving is done via Playwright route interception — no need to register
 * routes on the Fastify instance.
 */

import { chromium, type Browser, type Page } from 'playwright';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ExportQuality } from '@shared/utils/exportQuality';
import type { Project } from '@shared/types/project';

export interface MediaFileNames {
    screen?: string;
    camera?: string;
    mic?: string;
}

export interface PlaywrightRenderConfig {
    project: Project;
    quality: ExportQuality;
    mediaDir: string;
    mediaFileNames: MediaFileNames;
    onProgress?: (phase: string, progress: number, message: string) => void;
}

export interface RenderResult {
    outputPath: string;
    durationMs: number;
}

// Path to the built render page
const RENDER_PAGE_DIST = path.resolve(import.meta.dirname, '../../../render-worker/render-page/dist');

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

export async function renderViaPlaywright(config: PlaywrightRenderConfig): Promise<RenderResult> {
    const { project, quality, mediaDir, mediaFileNames, onProgress } = config;
    const log = onProgress ?? ((phase: string, _p: number, msg: string) => console.log(`[Render] [${phase}] ${msg}`));
    const startTime = Date.now();

    let browser: Browser | null = null;

    try {
        log('prepare', 0.2, 'Launching headless Chromium...');
        browser = await chromium.launch({
            headless: true,
            args: [
                '--enable-gpu-rasterization',
                '--disable-web-security',
                '--autoplay-policy=no-user-gesture-required',
            ],
        });

        const page: Page = await browser.newPage();

        // --- Intercept requests to serve files locally ---
        // Use localhost URLs so the browser treats it as a secure context
        // (required for crypto.randomUUID, WebCodecs, etc.)

        // Serve render page files at http://localhost:9999/*
        await page.route('http://localhost:9999/**', async (route) => {
            const url = new URL(route.request().url());
            let filePath = url.pathname === '/' ? '/index.html' : url.pathname;
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

        // Serve media files at http://localhost:9998/*
        await page.route('http://localhost:9998/**', async (route) => {
            const url = new URL(route.request().url());
            const filePath = url.pathname.slice(1); // remove leading /
            const fullPath = path.join(mediaDir, filePath);

            if (fs.existsSync(fullPath)) {
                const body = fs.readFileSync(fullPath);
                await route.fulfill({
                    status: 200,
                    contentType: getMimeType(fullPath),
                    body,
                });
            } else {
                console.warn(`[Render] Media 404: ${fullPath}`);
                await route.fulfill({ status: 404, body: 'Not found' });
            }
        });

        // Log browser console to backend console
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

        // --- Inject job config before page loads ---
        const mediaBaseUrl = 'http://localhost:9998/';
        const renderJob = { project, quality, mediaBaseUrl, mediaFileNames };

        await page.addInitScript((job: any) => {
            (window as any).__RENDER_JOB__ = job;
        }, renderJob);

        log('prepare', 0.3, 'Navigating to render page...');
        await page.goto('http://localhost:9999/', {
            waitUntil: 'domcontentloaded',
            timeout: 30_000,
        });

        log('render', 0, 'Render page loaded, waiting for export to complete...');

        // --- Wait for render to finish ---
        const pollInterval = setInterval(async () => {
            try {
                const status = await page.evaluate(() => {
                    const el = document.getElementById('status');
                    return el?.textContent ?? '';
                });
                if (status) {
                    log('render', 0.5, `Page status: ${status}`);
                }
            } catch { /* page may be navigating */ }
        }, 2000);

        await page.waitForFunction('window.__RENDER_DONE__ === true', {
            timeout: 300_000, // 5 minute timeout
            polling: 500,
        });

        clearInterval(pollInterval);

        // --- Check for errors ---
        const error = await page.evaluate(() => (window as any).__RENDER_ERROR__);
        if (error) {
            throw new Error(`Render page error: ${error}`);
        }

        // --- Extract result ---
        log('finalize', 0.8, 'Extracting MP4 from browser...');
        const resultBuffer = await page.evaluate(() => {
            const ab = (window as any).__RENDER_RESULT__ as ArrayBuffer;
            return Array.from(new Uint8Array(ab));
        });

        const outputPath = path.join(mediaDir, 'output.mp4');
        fs.writeFileSync(outputPath, Buffer.from(resultBuffer));

        const durationMs = Date.now() - startTime;
        const sizeMB = (resultBuffer.length / 1024 / 1024).toFixed(2);
        log('finalize', 1, `Done! ${sizeMB} MB written to ${outputPath} in ${(durationMs / 1000).toFixed(1)}s`);

        return { outputPath, durationMs };

    } finally {
        if (browser) {
            await browser.close();
        }
    }
}
