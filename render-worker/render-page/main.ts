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
    quality: ExportQuality;
    mediaBaseUrl: string; // e.g. http://localhost:9998/
    mediaFileNames: { screen?: string; camera?: string; mic?: string };
}

declare global {
    interface Window {
        __RENDER_JOB__?: RenderJob;
        __RENDER_DONE__?: boolean;
        __RENDER_ERROR__?: string;
        __RENDER_RESULT__?: ArrayBuffer;
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
            img.onerror = reject;
            img.src = src;
        });
    },
};

// ── UI helpers ─────────────────────────────────────────────────

const statusEl = document.getElementById('status')!;
const progressFill = document.getElementById('progress-fill')!;
const logEl = document.getElementById('log')!;

function log(msg: string, cls?: string) {
    const line = document.createElement('div');
    if (cls) line.className = cls;
    line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    logEl.appendChild(line);
    logEl.scrollTop = logEl.scrollHeight;
    console.log(msg);
}

function setStatus(msg: string) {
    statusEl.textContent = msg;
}

function setProgress(fraction: number) {
    progressFill.style.width = `${(fraction * 100).toFixed(1)}%`;
}

// ── Main ───────────────────────────────────────────────────────

async function run() {
    const job = window.__RENDER_JOB__;
    if (!job) {
        log('No __RENDER_JOB__ found. Set window.__RENDER_JOB__ and reload to test manually.', 'error');
        setStatus('No render job');
        return;
    }

    const { project, quality, mediaBaseUrl, mediaFileNames } = job;
    log(`Render job received: "${project.name}" @ ${quality}`);
    log(`Media base URL: ${mediaBaseUrl}`);
    log(`Media files: ${JSON.stringify(mediaFileNames)}`);

    // Patch runtimeUrl on each source to point at the local media server.
    if (project.screenSource && mediaFileNames.screen) {
        project.screenSource.runtimeUrl = `${mediaBaseUrl}${mediaFileNames.screen}`;
        log(`Screen URL: ${project.screenSource.runtimeUrl}`);
    }
    if (project.cameraSource && mediaFileNames.camera) {
        project.cameraSource.runtimeUrl = `${mediaBaseUrl}${mediaFileNames.camera}`;
        log(`Camera URL: ${project.cameraSource.runtimeUrl}`);
    }
    if (project.microphoneSource && mediaFileNames.mic) {
        project.microphoneSource.runtimeUrl = `${mediaBaseUrl}${mediaFileNames.mic}`;
        log(`Mic URL: ${project.microphoneSource.runtimeUrl}`);
    }

    setStatus('Exporting...');

    const env: ExportEnvironment = {
        renderContext: browserRenderContext,
        // Headless: always use software decode (no GPU)
        videoDecodePreference: 'cpu',
    };

    try {
        const exporter = new ExportManager();
        const result = await exporter.exportProject(project, quality, (progress) => {
            const pct = (progress.progress * 100).toFixed(1);
            const phase = progress.phase ?? 'exporting';
            setStatus(`${phase}: ${pct}%`);
            setProgress(progress.progress);
            if (progress.timeRemainingSeconds != null) {
                log(`${phase} ${pct}% — ETA ${progress.timeRemainingSeconds.toFixed(1)}s`);
            }
        }, { skipDownload: true }, env);

        log(`Export complete! Blob size: ${(result.blob.size / 1024 / 1024).toFixed(2)} MB`, 'success');
        log(`Codecs: video=${result.codecs.video.encoder}, audio=${result.codecs.audio.encoder}`, 'success');

        // Store result for Playwright to extract
        window.__RENDER_RESULT__ = await result.blob.arrayBuffer();
        window.__RENDER_DONE__ = true;
        setStatus('Done!');
        setProgress(1);

    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log(`Export failed: ${message}`, 'error');
        window.__RENDER_ERROR__ = message;
        window.__RENDER_DONE__ = true;
        setStatus('Failed');
    }
}

run();
