/**
 * Server-side export pipeline.
 *
 * Orchestrates the full video render: decodes source frames via FFmpeg,
 * paints each frame using the shared painter stack, pipes raw RGBA to
 * an FFmpeg encoder, and mixes audio — producing a final MP4 file.
 *
 * This mirrors the browser's ExportManager.runExport() but uses Node.js
 * primitives instead of WebCodecs/OfflineAudioContext.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';

// Shared types
import type { Project, Rect, CameraSettings } from '@shared/types';
import type { UserEvents } from '@shared/types/events';

// Shared rendering modules
import { drawBackground } from '@shared/painters/backgroundPainter';
import { drawScreen } from '@shared/painters/screenPainter';
import { paintMouseClicks } from '@shared/painters/mouseClickPainter';
import { drawDragEffects } from '@shared/painters/mouseDragPainter';
import { drawCamera } from '@shared/painters/cameraPainter';
import { drawKeyboardOverlay } from '@shared/painters/keyboardPainter';
import { drawCaptions } from '@shared/painters/captionPainter';
import { drawOverlays } from '@shared/painters/overlayPainter';
import { drawSpotlight } from '@shared/painters/spotlightPainter';
import { getViewportStateAtTime } from '@shared/animators/zoomAnimator';
import { getSpotlightStateAtTime } from '@shared/animators/spotlightAnimator';
import { getResolvedCameraStateAtTime } from '@shared/animators/cameraAnimator';
import { TimeMapper } from '@shared/mappers/timeMapper';
import { getDeviceFrame } from '@shared/utils/deviceFrames';

// Render worker modules
import { nodeRenderContext } from './nodeRenderContext';
import { ServerFrameExtractor, type FrameData } from './ServerFrameExtractor';
import { mixAudio } from './ServerAudioMixer';

// Shared utilities
import { scaleProject } from '@shared/utils/projectScale';
import { getHeightForQuality, type ExportQuality } from '@shared/utils/exportQuality';

export interface RenderJobConfig {
    /** Full project data including userEvents */
    project: Project;
    /** Project name (DB column, not in project_data) */
    projectName?: string;
    /** Export quality */
    quality: ExportQuality;
    /** Directory containing downloaded media files */
    mediaDir: string;
    /** Progress callback — logs to console */
    onProgress?: (phase: string, progress: number, message: string) => void;
}

export interface RenderResult {
    outputPath: string;
    durationMs: number;
    framesRendered: number;
}

/**
 * Run the full server-side export pipeline.
 */
export async function renderProject(config: RenderJobConfig): Promise<RenderResult> {
    const { project, projectName, quality, mediaDir } = config;
    const log = config.onProgress ?? ((phase, progress, msg) => {
        console.log(`[Render] [${phase}] ${(progress * 100).toFixed(1)}% — ${msg}`);
    });

    const fps = 30;
    const targetHeight = getHeightForQuality(quality);
    const aspectRatio = project.settings.outputSize.width / project.settings.outputSize.height;
    const targetWidth = Math.round(targetHeight * aspectRatio);

    // Ensure even dimensions for H.264
    const width = targetWidth % 2 === 0 ? targetWidth : targetWidth + 1;
    const height = targetHeight % 2 === 0 ? targetHeight : targetHeight + 1;

    log('prepare', 0, `Scaling project to ${width}x${height}`);
    const renderProject = scaleProject(project, { width, height });
    const userEvents = renderProject.userEvents;

    // --- Initialize frame extractors ---
    log('prepare', 0.1, 'Initializing frame extractors...');
    const frameExtractors: Record<string, ServerFrameExtractor> = {};

    const screenPath = findMediaFile(mediaDir, 'screen');
    if (screenPath) {
        const ext = new ServerFrameExtractor(screenPath);
        await ext.initialize();
        frameExtractors[renderProject.screenSource.storagePath] = ext;
        log('prepare', 0.3, `Screen extractor ready: ${ext.width}x${ext.height}, ${ext.duration.toFixed(1)}s`);
    }

    if (renderProject.cameraSource) {
        const cameraPath = findMediaFile(mediaDir, 'camera');
        if (cameraPath) {
            const ext = new ServerFrameExtractor(cameraPath);
            await ext.initialize();
            frameExtractors[renderProject.cameraSource.storagePath] = ext;
            log('prepare', 0.4, `Camera extractor ready: ${ext.width}x${ext.height}`);
        }
    }

    // --- Build TimeMapper ---
    const timeMapper = new TimeMapper(renderProject.timeline.outputWindows);
    const totalDurationMs = timeMapper.outputDuration;
    const totalDurationSec = totalDurationMs / 1000;
    const totalFrames = Math.ceil(totalDurationMs / (1000 / fps));
    log('prepare', 0.5, `Duration: ${totalDurationSec.toFixed(1)}s, ${totalFrames} frames`);

    // --- Load images ---
    let bgImage: CanvasImageSource | null = null;
    let deviceFrameImg: CanvasImageSource | null = null;

    const bgSettings = renderProject.settings.background;
    if (bgSettings.type === 'preset' || bgSettings.type === 'custom') {
        const bgUrl = bgSettings.imageUrl; // CDN URL for presets
        if (bgUrl && bgUrl.startsWith('http')) {
            try {
                bgImage = await nodeRenderContext.loadImage(bgUrl);
                log('prepare', 0.6, 'Background image loaded');
            } catch (e) {
                log('prepare', 0.6, `Failed to load background image: ${e}`);
            }
        }
    }

    const screenSettings = renderProject.settings.screen;
    if (screenSettings.mode === 'device' && screenSettings.deviceFrameId) {
        const frameDef = getDeviceFrame(screenSettings.deviceFrameId);
        if (frameDef?.imageUrl && frameDef.imageUrl.startsWith('http')) {
            try {
                deviceFrameImg = await nodeRenderContext.loadImage(frameDef.imageUrl);
                log('prepare', 0.7, 'Device frame image loaded');
            } catch (e) {
                log('prepare', 0.7, `Failed to load device frame image: ${e}`);
            }
        }
    }

    // --- Mix audio ---
    log('prepare', 0.8, 'Mixing audio...');
    const audioPath = path.join(mediaDir, 'audio.aac');
    await mixAudio({
        project: renderProject,
        totalDurationSec,
        userEvents,
        timeMapper,
        mediaDir,
        outputPath: audioPath,
    });
    log('prepare', 0.9, 'Audio mixed');

    // --- Start FFmpeg encoder ---
    const outputPath = path.join(mediaDir, 'output.mp4');
    const ffmpegArgs = [
        // Video input: raw RGBA from stdin
        '-f', 'rawvideo',
        '-pix_fmt', 'rgba',
        '-s', `${width}x${height}`,
        '-r', String(fps),
        '-i', 'pipe:0',
    ];

    // Audio input (if audio file exists and has content)
    if (fs.existsSync(audioPath) && fs.statSync(audioPath).size > 0) {
        const audioSize = fs.statSync(audioPath).size;
        console.log(`[Render] Audio file exists: ${audioPath} (${(audioSize / 1024).toFixed(1)} KB)`);
        if (audioSize > 4096) {
            ffmpegArgs.push('-i', audioPath, '-c:a', 'copy');
        } else {
            console.log(`[Render] Audio file too small (${audioSize} bytes) — skipping, likely corrupt`);
        }
    } else {
        console.log(`[Render] No audio file or empty: ${audioPath}`);
    }

    ffmpegArgs.push(
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-crf', '23',
        '-pix_fmt', 'yuv420p',
        // '-movflags', '+faststart',  // disabled: causes FFmpeg to buffer entire output
        '-v', 'error',
        '-y',
        outputPath,
    );

    console.log(`[Render] FFmpeg command: ffmpeg ${ffmpegArgs.join(' ')}`);
    const ffmpeg = spawn('ffmpeg', ffmpegArgs, {
        stdio: ['pipe', 'ignore', 'pipe'],
    });

    console.log(`[Render] FFmpeg spawned, pid=${ffmpeg.pid}`);
    console.log(`[Render] FFmpeg stdin: writable=${ffmpeg.stdin!.writable}, highWaterMark=${(ffmpeg.stdin! as any).writableHighWaterMark}`);

    let ffmpegExited = false;
    let ffmpegStderr = '';
    ffmpeg.stderr!.on('data', (data: Buffer) => {
        const msg = data.toString();
        ffmpegStderr += msg;
        console.log(`[Render] FFmpeg stderr: ${msg.trim()}`);
    });
    ffmpeg.on('error', (err: Error) => { console.log(`[Render] FFmpeg spawn error: ${err.message}`); });
    ffmpeg.on('close', (code: number | null) => {
        ffmpegExited = true;
        console.log(`[Render] FFmpeg encoder exited with code ${code}`);
    });

    // --- Frame render loop ---
    log('render', 0, `Starting frame loop: ${totalFrames} frames at ${fps}fps`);
    const startTime = Date.now();

    for (let i = 0; i < totalFrames; i++) {
        const frameStart = Date.now();
        const currentTimeMs = i * (1000 / fps);
        const sourceTimeMs = timeMapper.mapOutputToSourceTime(currentTimeMs);

        // Extract source frames
        const videoRefs: Record<string, CanvasImageSource> = {};
        const t0 = Date.now();
        for (const [id, ext] of Object.entries(frameExtractors)) {
            const frame = await ext.getFrameAtTime(sourceTimeMs / 1000);
            videoRefs[id] = frame.canvas;
        }
        const extractMs = Date.now() - t0;

        // Create output canvas
        const { canvas, ctx } = nodeRenderContext.createCanvas(width, height);

        // Clear
        ctx.clearRect(0, 0, width, height);

        // 1. Background
        const t1 = Date.now();
        drawBackground(ctx, renderProject.settings.background, renderProject.settings.background.backgroundBlurPx, { width, height }, bgImage);
        const bgMs = Date.now() - t1;

        // 2-7. Painter stack (replicating PlaybackRenderer.render)
        const t2 = Date.now();
        renderFrame(ctx, nodeRenderContext, renderProject, userEvents, videoRefs, deviceFrameImg, canvas, currentTimeMs, timeMapper, projectName);
        const paintMs = Date.now() - t2;

        // Get raw RGBA buffer and pipe to FFmpeg
        const t3 = Date.now();
        const rawCanvas = canvas as any;
        let rgbaBuffer: Buffer;
        if (typeof rawCanvas.data === 'function') {
            // @napi-rs/canvas Canvas.data() returns raw pixel data
            rgbaBuffer = Buffer.from(rawCanvas.data());
        } else if (typeof rawCanvas.toBuffer === 'function') {
            rgbaBuffer = rawCanvas.toBuffer('raw');
        } else {
            // Fallback: get ImageData from context
            const imageData = ctx.getImageData(0, 0, width, height);
            rgbaBuffer = Buffer.from(imageData.data.buffer);
        }
        const bufferMs = Date.now() - t3;

        // Write to FFmpeg stdin with backpressure handling
        const t4 = Date.now();
        const stdin = ffmpeg.stdin!;
        if (i < 5) {
            console.log(`[Render] Frame ${i} pre-write: bufferSize=${rgbaBuffer.length}, stdinWritable=${stdin.writable}, stdinDestroyed=${stdin.destroyed}, ffmpegExited=${ffmpegExited}, writableLength=${(stdin as any).writableLength}, writableHighWaterMark=${(stdin as any).writableHighWaterMark}`);
        }
        const canWrite = stdin.write(rgbaBuffer);
        if (i < 5) {
            console.log(`[Render] Frame ${i} post-write: canWrite=${canWrite}, writableLength=${(stdin as any).writableLength}`);
        }
        if (!canWrite) {
            if (i < 5) console.log(`[Render] Frame ${i}: waiting for drain...`);
            await new Promise<void>(resolve => stdin.once('drain', resolve));
            if (i < 5) console.log(`[Render] Frame ${i}: drain received after ${Date.now() - t4}ms`);
        }
        const writeMs = Date.now() - t4;

        // Log timing for first 5 frames and every 30th
        if (i < 5 || (i + 1) % 30 === 0) {
            console.log(`[Render] Frame ${i}: extract=${extractMs}ms bg=${bgMs}ms paint=${paintMs}ms buffer=${bufferMs}ms write=${writeMs}ms total=${Date.now() - frameStart}ms`);
        }

        // Progress every 30 frames
        if ((i + 1) % 30 === 0 || i === totalFrames - 1) {
            const elapsed = (Date.now() - startTime) / 1000;
            const fpsRate = (i + 1) / elapsed;
            const remaining = (totalFrames - i - 1) / fpsRate;
            log('render', (i + 1) / totalFrames,
                `Frame ${i + 1}/${totalFrames} (${fpsRate.toFixed(1)} fps, ~${remaining.toFixed(0)}s remaining)`);
        }
    }

    // Close FFmpeg stdin and wait for it to finish
    log('render', 1, 'All frames sent, waiting for FFmpeg to finish encoding...');
    await new Promise<void>((resolve, reject) => {
        ffmpeg.stdin!.end();
        ffmpeg.on('close', (code) => {
            if (code !== 0) {
                reject(new Error(`FFmpeg encoder exited with code ${code}:\n${ffmpegStderr.slice(-2000)}`));
            } else {
                resolve();
            }
        });
    });

    // Cleanup extractors
    for (const ext of Object.values(frameExtractors)) {
        ext.dispose();
    }

    const totalElapsed = (Date.now() - startTime) / 1000;
    log('complete', 1, `Done! ${totalFrames} frames in ${totalElapsed.toFixed(1)}s (${(totalFrames / totalElapsed).toFixed(1)} fps avg)`);
    log('complete', 1, `Output: ${outputPath}`);

    return {
        outputPath,
        durationMs: totalDurationMs,
        framesRendered: totalFrames,
    };
}

/**
 * Render a single frame using the shared painter stack.
 * Replicates PlaybackRenderer.render() without editor-specific features.
 */
function renderFrame(
    ctx: CanvasRenderingContext2D,
    renderCtx: typeof nodeRenderContext,
    project: Project,
    userEvents: UserEvents,
    videoRefs: Record<string, CanvasImageSource>,
    deviceFrameImg: CanvasImageSource | null,
    sourceCanvas: CanvasImageSource & { width: number; height: number },
    currentTimeMs: number,
    timeMapper: TimeMapper,
    projectName?: string,
): void {
    const outputSize = project.settings.outputSize;
    const { timeline } = project;
    const screenSource = project.screenSource;
    const cameraSource = project.cameraSource;

    // Viewport calculation
    const zoomSegments = (project.settings.zoom.enabled ?? true)
        ? (timeline.zoomSegments || [])
        : [];

    const effectiveViewport: Rect = getViewportStateAtTime(
        zoomSegments, currentTimeMs, outputSize, project.settings.zoom
    );

    // Screen layer
    let viewMapper: any;
    const screenVideo = videoRefs[screenSource.storagePath];
    if (screenVideo) {
        const result = drawScreen(
            ctx, screenVideo, project, effectiveViewport,
            deviceFrameImg, currentTimeMs, timeMapper,
            userEvents?.urlChanges, projectName
        );
        viewMapper = result.viewMapper;

        // Mouse effects
        const mouse = project.settings.mouse;
        if (mouse && viewMapper) {
            if (mouse.mouseClickEnabled) {
                paintMouseClicks(ctx, userEvents.mouseClicks, currentTimeMs, effectiveViewport, viewMapper, mouse, timeMapper, outputSize);
            }
            if (mouse.mouseDragEnabled) {
                drawDragEffects(ctx, userEvents, currentTimeMs, effectiveViewport, viewMapper, mouse, timeMapper, outputSize);
            }
        }
    }

    // Spotlight
    if (viewMapper && (project.settings.spotlight.enabled ?? true)) {
        const spotlightState = getSpotlightStateAtTime(
            timeline.spotlightSegments || [],
            project.settings.spotlight,
            currentTimeMs,
            effectiveViewport,
            viewMapper
        );
        drawSpotlight(ctx, spotlightState, outputSize, sourceCanvas, renderCtx);
    }

    // Keyboard
    if (project.settings.keyboard?.showHotkeys ?? true) {
        drawKeyboardOverlay(ctx, userEvents.keyboardEvents, currentTimeMs, outputSize, timeMapper, project.settings.keyboard);
    }

    // Overlays
    if (project.settings.overlay?.enabled ?? true) {
        const overlaySegments = timeline.overlaySegments || [];
        if (overlaySegments.length > 0) {
            drawOverlays(ctx, overlaySegments, currentTimeMs, outputSize, effectiveViewport);
        }
    }

    // Camera
    if (cameraSource) {
        const video = videoRefs[cameraSource.storagePath];
        if (video) {
            const cameraSettings = project.settings.camera;
            if (cameraSettings) {
                const cameraMoveEnabled = project.settings.cameraMove?.enabled ?? true;
                const resolved = getResolvedCameraStateAtTime(
                    cameraSettings,
                    cameraMoveEnabled ? (timeline.cameraMoveSegments || []) : [],
                    zoomSegments,
                    currentTimeMs,
                    outputSize,
                    project.settings.zoom
                );

                if (resolved.opacity > 0) {
                    const effectiveSettings: CameraSettings = {
                        ...cameraSettings,
                        xPx: resolved.xPx,
                        yPx: resolved.yPx,
                        widthPx: resolved.widthPx,
                        heightPx: resolved.heightPx,
                        shape: resolved.shape,
                        borderRadiusPx: resolved.borderRadiusPx,
                    };

                    if (resolved.opacity < 1) {
                        ctx.save();
                        ctx.globalAlpha = resolved.opacity;
                        drawCamera(ctx, video, cameraSource.size, effectiveSettings, outputSize, renderCtx);
                        ctx.restore();
                    } else {
                        drawCamera(ctx, video, cameraSource.size, effectiveSettings, outputSize, renderCtx);
                    }
                }
            }
        }
    }

    // Captions
    if (project.settings.captions.enabled ?? true) {
        drawCaptions(ctx, timeline.captionSegments, project.settings.captions, currentTimeMs, outputSize);
    }
}

/**
 * Find a media file in the temp directory by prefix (screen, camera, mic).
 */
function findMediaFile(dir: string, prefix: string): string | null {
    const files = fs.readdirSync(dir);
    const match = files.find(f => f.startsWith(prefix + '.'));
    return match ? path.join(dir, match) : null;
}
