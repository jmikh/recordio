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

    // --- Detect encoder ---
    const useNvenc = await detectNvenc();
    log('prepare', 0.95, `NVENC available: ${useNvenc}`);

    // --- Phase 1: Render all frames to a raw file ---
    // Synchronous file writes avoid event-loop contention between the
    // WriteStream drain and FFmpeg decode-pipe data events that caused
    // hangs on Cloud Run. On tmpfs each writeSync is essentially memcpy.
    const rawFramesPath = path.join(mediaDir, 'frames.raw');
    const outputPath = path.join(mediaDir, 'output.mp4');
    const rawFd = fs.openSync(rawFramesPath, 'w');

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
        ctx.clearRect(0, 0, width, height);

        // 1. Background
        const t1 = Date.now();
        drawBackground(ctx, renderProject.settings.background, renderProject.settings.background.backgroundBlurPx, { width, height }, bgImage);
        const bgMs = Date.now() - t1;

        // 2-7. Painter stack
        const t2 = Date.now();
        renderFrame(ctx, nodeRenderContext, renderProject, userEvents, videoRefs, deviceFrameImg, canvas, currentTimeMs, timeMapper, projectName);
        const paintMs = Date.now() - t2;

        // Get raw RGBA buffer
        const t3 = Date.now();
        const rawCanvas = canvas as any;
        let rgbaBuffer: Buffer;
        if (typeof rawCanvas.data === 'function') {
            rgbaBuffer = Buffer.from(rawCanvas.data());
        } else if (typeof rawCanvas.toBuffer === 'function') {
            rgbaBuffer = rawCanvas.toBuffer('raw');
        } else {
            const imageData = ctx.getImageData(0, 0, width, height);
            rgbaBuffer = Buffer.from(imageData.data.buffer);
        }
        const bufferMs = Date.now() - t3;

        // Synchronous write to raw file (tmpfs = RAM, ~0ms)
        const t4 = Date.now();
        fs.writeSync(rawFd, rgbaBuffer);
        const writeMs = Date.now() - t4;

        // Yield to event loop every frame so FFmpeg decode data events fire
        await new Promise<void>(resolve => setImmediate(resolve));

        // Log timing every 30 frames
        if (i < 3 || (i + 1) % 30 === 0) {
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

    // Close raw frames file
    fs.closeSync(rawFd);
    const renderElapsed = (Date.now() - startTime) / 1000;
    const rawSize = fs.statSync(rawFramesPath).size;
    log('render', 1, `All ${totalFrames} frames rendered in ${renderElapsed.toFixed(1)}s (${(rawSize / 1024 / 1024).toFixed(0)} MB raw)`);

    // --- Phase 2: Encode raw frames with FFmpeg ---
    log('encode', 0, `Encoding with ${useNvenc ? 'h264_nvenc (GPU)' : 'libx264 (CPU)'}...`);
    const encodeStart = Date.now();

    const ffmpegArgs = [
        '-f', 'rawvideo',
        '-pix_fmt', 'rgba',
        '-s', `${width}x${height}`,
        '-r', String(fps),
        '-i', rawFramesPath,
    ];

    // Audio input
    if (fs.existsSync(audioPath) && fs.statSync(audioPath).size > 4096) {
        ffmpegArgs.push('-i', audioPath, '-c:a', 'copy');
    }

    if (useNvenc) {
        ffmpegArgs.push(
            '-c:v', 'h264_nvenc',
            '-preset', 'p4',
            '-rc', 'vbr',
            '-cq', '23',
            '-pix_fmt', 'yuv420p',
        );
    } else {
        ffmpegArgs.push(
            '-c:v', 'libx264',
            '-preset', 'ultrafast',
            '-crf', '23',
            '-pix_fmt', 'yuv420p',
        );
    }

    ffmpegArgs.push('-v', 'error', '-nostats', '-y', outputPath);

    console.log(`[Render] FFmpeg encode command: ffmpeg ${ffmpegArgs.join(' ')}`);
    const ffmpegStderr = await new Promise<string>((resolve, reject) => {
        const ffmpeg = spawn('ffmpeg', ffmpegArgs, {
            stdio: ['ignore', 'ignore', 'pipe'],
        });
        let stderr = '';
        ffmpeg.stderr!.on('data', (d: Buffer) => { stderr += d.toString(); });
        ffmpeg.on('close', (code) => {
            if (code !== 0) {
                reject(new Error(`FFmpeg exited with code ${code}:\n${stderr.slice(-2000)}`));
            } else {
                resolve(stderr);
            }
        });
        ffmpeg.on('error', (err) => reject(err));
    });

    if (ffmpegStderr.trim()) {
        console.log(`[Render] FFmpeg stderr: ${ffmpegStderr.trim().slice(-1000)}`);
    }

    // Cleanup raw frames
    fs.unlinkSync(rawFramesPath);

    const encodeElapsed = (Date.now() - startTime) / 1000;
    log('encode', 1, `Encoded in ${((Date.now() - encodeStart) / 1000).toFixed(1)}s`);

    // Cleanup extractors
    for (const ext of Object.values(frameExtractors)) {
        ext.dispose();
    }

    const totalElapsed = (Date.now() - startTime) / 1000;
    const encoder = useNvenc ? 'h264_nvenc' : 'libx264';
    log('complete', 1, `Done! ${totalFrames} frames in ${totalElapsed.toFixed(1)}s (${(totalFrames / totalElapsed).toFixed(1)} fps avg, encoder=${encoder})`);
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
 * Check if FFmpeg h264_nvenc actually works by encoding a single test frame.
 * Just checking `-encoders` isn't enough — NVENC can be compiled in but fail
 * at runtime if the GPU driver doesn't expose encoding capabilities.
 */
async function detectNvenc(): Promise<boolean> {
    return new Promise((resolve) => {
        const startMs = Date.now();
        // Encode a single 320x240 black frame with NVENC (larger than 64x64 to
        // avoid minimum resolution issues, -v verbose for detailed error output)
        const proc = spawn('ffmpeg', [
            '-v', 'verbose',
            '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', '320x240', '-r', '30',
            '-i', 'pipe:0',
            '-frames:v', '1',
            '-c:v', 'h264_nvenc', '-preset', 'p1', '-pix_fmt', 'yuv420p',
            '-f', 'null', '-',
        ], {
            stdio: ['pipe', 'ignore', 'pipe'],
        });
        let stderr = '';
        proc.stderr!.on('data', (d: Buffer) => { stderr += d.toString(); });
        // Feed one 320x240 RGBA frame then close stdin
        const frame = Buffer.alloc(320 * 240 * 4);
        proc.stdin!.write(frame);
        proc.stdin!.end();
        proc.on('close', (code) => {
            const elapsed = Date.now() - startMs;
            const ok = code === 0;
            // Log full stderr to see NVENC init details
            console.log(`[Render] NVENC probe: code=${code}, ${elapsed}ms`);
            for (const line of stderr.split('\n').filter(l => l.trim())) {
                console.log(`[Render] NVENC probe stderr: ${line.trim()}`);
            }
            resolve(ok);
        });
        proc.on('error', () => { resolve(false); });
        // Timeout after 10s
        setTimeout(() => { proc.kill('SIGTERM'); }, 10_000);
    });
}

/**
 * Find a media file in the temp directory by prefix (screen, camera, mic).
 */
function findMediaFile(dir: string, prefix: string): string | null {
    const files = fs.readdirSync(dir);
    const match = files.find(f => f.startsWith(prefix + '.'));
    return match ? path.join(dir, match) : null;
}
