/**
 * Render page entry point.
 *
 * This page is loaded by Playwright (headless Chromium) to run the browser
 * export pipeline server-side. It receives a job config via window.__RENDER_JOB__,
 * patches media URLs to point at locally-served files, runs ExportManager,
 * and exposes the result on window globals for Playwright to extract.
 *
 * The page does NO network I/O beyond fetching the pre-downloaded media files
 * from the worker's static file server.
 */

import { ExportManager, type ExportEnvironment } from '@shared/export/ExportManager';
import type { ExportQuality } from '@shared/utils/exportQuality';
import type { Project } from '@shared/types';
import type { RenderContext } from '@shared/utils/renderContext';

// ── Types ──────────────────────────────────────────────────────

interface RenderJob {
    project: Project;
    projectName?: string;
    quality: ExportQuality;
    mediaBaseUrl: string; // e.g. http://localhost:8080/media/jobId/
    resultUrl: string;    // e.g. http://localhost:8080/result/jobId
    /** storagePath → local filename */
    mediaFileNames: Record<string, string>;
}

declare global {
    interface Window {
        __RENDER_JOB__?: RenderJob;
        __RENDER_DONE__?: boolean;
        __RENDER_ERROR__?: string;
        __RENDER_FRAMES_DONE__?: number;
        __RENDER_FRAMES_TOTAL__?: number;
    }
}

// ── Browser render context (headless Chromium has full DOM/Canvas) ──

const browserRenderContext: RenderContext = {
    createCanvas(w: number, h: number) {
        const canvas = new OffscreenCanvas(w, h);
        return { canvas, ctx: canvas.getContext('2d')! as unknown as CanvasRenderingContext2D };
    },
    loadImage(src: string): Promise<CanvasImageSource> {
        return new Promise((resolve, reject) => {
            const img = new Image();
            if (!src.startsWith('blob:')) {
                img.crossOrigin = 'anonymous';
            }
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
            img.src = src;
        });
    },
};


// ── Main ───────────────────────────────────────────────────────

async function run() {
    const job = window.__RENDER_JOB__;
    if (!job) {
        console.error('No __RENDER_JOB__ found.');
        return;
    }

    const { project, projectName, quality, mediaBaseUrl, mediaFileNames: rawMediaFileNames } = job;
    // CDP serialization via addInitScript can produce objects where Object.entries()
    // doesn't iterate. Force a clean plain object via JSON round-trip.
    const mediaFileNames: Record<string, string> = JSON.parse(JSON.stringify(rawMediaFileNames ?? {}));
    console.log(`Render job received: "${projectName ?? project.id}" @ ${quality}`);
    console.log(`Media base URL: ${mediaBaseUrl}`);
    console.log(`Media files (${Object.keys(mediaFileNames).length}): ${JSON.stringify(mediaFileNames)}`);

    // Build mediaUrls map for the export pipeline (storagePath → local HTTP URL)
    const mediaUrls: Record<string, string> = {};
    for (const [storagePath, localName] of Object.entries(mediaFileNames)) {
        const url = `${mediaBaseUrl}${localName}`;
        mediaUrls[storagePath] = url;
        console.log(`Media: ${storagePath} → ${url}`);
    }

    const env: ExportEnvironment = {
        renderContext: browserRenderContext,
        videoDecodePreference: 'gpu',
        decodePreferences: {
            getPreferSoftwareDecode: () => false,
            setPreferSoftwareDecode: () => {},
        },
        mediaUrls,
    };

    try {
        const exporter = new ExportManager();
        const result = await exporter.exportProject(project, quality, (progress) => {
            window.__RENDER_FRAMES_DONE__ = progress.framesProcessed;
            window.__RENDER_FRAMES_TOTAL__ = progress.totalFrames;
        }, { skipDownload: true }, env, projectName);

        console.log(`Export complete! Blob size: ${(result.blob!.size / 1024 / 1024).toFixed(2)} MB`);
        console.log(`Codecs: video=${result.codecs.video.encoder}, audio=${result.codecs.audio.encoder}`);

        // Send result to Fastify (direct HTTP, bypasses CDP pipe)
        console.log(`Sending result to ${job.resultUrl}...`);
        const uploadResp = await fetch(job.resultUrl, {
            method: 'PUT',
            body: result.blob,
            headers: { 'Content-Type': 'video/mp4' },
        });
        if (!uploadResp.ok) throw new Error(`Result POST failed: ${uploadResp.status}`);
        console.log('Result sent to server.');
        window.__RENDER_DONE__ = true;

    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Export failed: ${message}`);
        window.__RENDER_ERROR__ = message;
        window.__RENDER_DONE__ = true;
    }
}

run();
