import * as Mp4Muxer from 'mp4-muxer';
import { scaleProject } from '../utils/projectScale';
import { PlaybackRenderer } from './PlaybackRenderer';
import { drawBackground } from '../painters/backgroundPainter';

import { getDeviceFrame } from '../utils/deviceFrames';
import { TimeMapper } from '../mappers/timeMapper';
import { FrameExtractor, type DecodePreferences } from './FrameExtractor';
import { resolveVideoCodec, resolveAudioCodec, getHeightForQuality, type ExportFps } from './codecResolver';
import { renderAudioBuffer, encodeAudioBuffer, type SoundEffectBuffers } from './audioProcessor';
import { computeFrameSignature } from './frameSignature';
import { preloadToolbarIcons } from '../painters/toolbarPainter';
import { getCaptionFont } from '../painters/captionPainter';
import { getKeyboardFont } from '../painters/keyboardPainter';
import { getOverlayTextFont } from '../painters/overlayPainter';
import type { Project, SourceMetadata } from '../types';
import type { RenderContext } from '../utils/renderContext';

export type { ExportQuality, ExportFps } from './codecResolver';

export interface ExportProgress {
    progress: number;
    timeRemainingSeconds: number | null;
    phase?: 'preparing' | 'exporting' | 'uploading';
    decodeFallback?: boolean;
    framesProcessed?: number;
    totalFrames?: number;
}

export interface ExportCodecInfo {
    video: { encoder: string; muxer: string; fallback: boolean; tried: string[] };
    audio: { encoder: string; muxer: string; fallback: boolean };
}

export interface ExportResult {
    /** Null when onMuxedData was provided (chunks were streamed externally). */
    blob: Blob | null;
    codecs: ExportCodecInfo;
    videoDecodeMode: 'hardware' | 'software';
    videoDecodeFallback: boolean;
}

/**
 * Environment-specific dependencies injected by the caller.
 * In webapp: browserRenderContext + useUIStore + download function.
 * In headless render: headless renderContext, no download.
 */
export interface ExportEnvironment {
    renderContext: RenderContext;
    /** Current decode preference ('gpu' | 'cpu'). Defaults to 'gpu'. */
    videoDecodePreference?: 'gpu' | 'cpu';
    /** Called when decode fallback triggers — lets the caller update UI/prefs. */
    onDecodeFallback?: () => void;
    /** Decode preference storage for FrameExtractor. */
    decodePreferences?: DecodePreferences;
    /** Sound effect buffers for click/drag mixing. If omitted, sounds are skipped. */
    soundEffects?: SoundEffectBuffers;
    /** Media URLs keyed by source ID. Used for video decoding and audio fetch. */
    mediaUrls?: Record<string, string>;
    /**
     * Optional sink for muxed MP4 chunks. If provided, chunks are streamed
     * here instead of buffered in memory, and result.blob will be null.
     * Used by the render worker to avoid holding the full MP4 in browser memory.
     */
    onMuxedData?: (data: Uint8Array, position: number) => void;
}

export interface ExportOptions {
    skipDownload?: boolean;
    /** Output frame rate (default 30). With VFR this is the maximum: static stretches encode fewer frames. */
    fps?: ExportFps;
    /**
     * Default 'variable': output frames that would look identical to the last
     * encoded one are skipped, so the previous frame lasts longer (VFR output).
     * 'constant': every 1/fps slot is drawn and encoded.
     */
    frameRateMode?: 'constant' | 'variable';
    /**
     * VFR debug: still draw frames that would be skipped and compare their
     * pixels with the last encoded frame, logging mismatches. Slow.
     */
    verifySkippedFrames?: boolean;
}

/** VFR: longest a single encoded frame may be held before it's re-encoded. */
const MAX_FRAME_HOLD_MS = 1000;

/** Keyframe spacing in output time (VFR; CFR forces one every fps * 2 frames). */
const KEYFRAME_INTERVAL_MS = 2000;

/** VFR verify mode: stop logging individual mismatches after this many. */
const MAX_LOGGED_MISMATCHES = 20;

/** Maximum number of full export retries on codec reclaim errors. */
const MAX_EXPORT_RETRIES = 2;

/** Maximum time (ms) to wait for backpressure to drain before treating it as stuck. */
const BACKPRESSURE_TIMEOUT_MS = 15_000;

export class ExportManager {
    private abortController: AbortController | null = null;

    async exportProject(
        project: Project,
        quality: import('./codecResolver').ExportQuality,
        onProgress: (state: ExportProgress) => void,
        options?: ExportOptions,
        env?: ExportEnvironment,
        projectName?: string,
    ): Promise<ExportResult> {
        this.abortController = new AbortController();
        const signal = this.abortController.signal;

        let lastError: Error | null = null;

        for (let attempt = 0; attempt <= MAX_EXPORT_RETRIES; attempt++) {
            if (signal.aborted) throw new Error("Export cancelled");

            if (attempt > 0) {
                console.warn(`[Export] Retrying export (attempt ${attempt + 1}/${MAX_EXPORT_RETRIES + 1})`);
                onProgress({ progress: 0, timeRemainingSeconds: null });
            }

            try {
                const result = await this.runExport(project, quality, onProgress, signal, options, env, projectName);
                return result;
            } catch (e) {
                if (signal.aborted) throw new Error('Export cancelled');

                const error = e instanceof Error ? e : new Error(String(e));

                if (isCodecReclaimError(error) && attempt < MAX_EXPORT_RETRIES) {
                    console.warn('[Export] Codec reclaimed — scheduling retry:', error.message);
                    lastError = error;
                    await new Promise(r => setTimeout(r, 500));
                    continue;
                }

                throw e;
            }
        }

        throw lastError ?? new Error('Export failed after all retries');
    }

    /**
     * Core export logic — isolated so the outer method can retry it.
     */
    private async runExport(
        project: Project,
        quality: import('./codecResolver').ExportQuality,
        onProgress: (state: ExportProgress) => void,
        signal: AbortSignal,
        options?: ExportOptions,
        env?: ExportEnvironment,
        projectName?: string,
    ): Promise<ExportResult> {
        const renderCtx = env?.renderContext;
        if (!renderCtx) {
            throw new Error('[ExportManager] renderContext is required in ExportEnvironment');
        }

        const fps = options?.fps ?? 30;
        const targetHeight = getHeightForQuality(quality);
        const aspectRatio = project.settings.outputSize.width / project.settings.outputSize.height;
        const targetWidth = Math.round(targetHeight * aspectRatio);

        // Ensure even dimensions for encoder compatibility
        const width = targetWidth % 2 === 0 ? targetWidth : targetWidth + 1;
        const height = targetHeight % 2 === 0 ? targetHeight : targetHeight + 1;

        const renderProject = scaleProject(project, { width, height });

        // Probe codec support
        const videoCodec = await resolveVideoCodec(quality, width, height, fps);
        const audioCodec = await resolveAudioCodec();

        console.log(`[Export] Video codec: ${videoCodec.muxerCodec} (${videoCodec.config.codec}), ` +
            `fallback=${videoCodec.fallback}, tried=[${videoCodec.tried.join(', ')}], ` +
            `hwAccel=${videoCodec.config.hardwareAcceleration ?? 'default'}, ` +
            `${width}x${height} @ ${fps}fps, ${videoCodec.config.bitrate! / 1_000_000}Mbps`);

        // Stream muxer output — either to an external sink or to an in-memory buffer
        const streaming = !!env?.onMuxedData;
        const muxedChunks: { data: Uint8Array; position: number }[] = [];
        const muxer = new Mp4Muxer.Muxer({
            target: new Mp4Muxer.StreamTarget({
                onData: streaming
                    ? (data, position) => env!.onMuxedData!(data, position)
                    : (data, position) => muxedChunks.push({ data, position }),
                chunked: true,
                chunkSize: 16 * 1024 * 1024,
            }),
            video: {
                codec: videoCodec.muxerCodec,
                width,
                height
            },
            audio: {
                codec: audioCodec.muxerCodec,
                numberOfChannels: 2,
                sampleRate: 44100
            },
            fastStart: false
        });

        let videoEncoderError: Error | null = null;
        const videoEncoder = new VideoEncoder({
            output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
            error: (e) => {
                console.error("VideoEncoder error:", e.name, e.message);
                videoEncoderError = e;
            }
        });

        videoEncoder.configure(videoCodec.config);

        let audioEncoderFailed = false;
        const audioEncoder = new AudioEncoder({
            output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
            error: (e) => {
                console.error("AudioEncoder error:", e);
                audioEncoderFailed = true;
            }
        });

        audioEncoder.configure({
            codec: audioCodec.encoderCodec,
            numberOfChannels: 2,
            sampleRate: 44100,
            bitrate: 128000
        });

        const offscreenCanvas = new OffscreenCanvas(width, height);
        const ctx = offscreenCanvas.getContext('2d') as unknown as CanvasRenderingContext2D;

        const frameExtractors: Record<string, FrameExtractor> = {};
        const imageElements: { bg: CanvasImageSource | null, device: CanvasImageSource | null } = { bg: null, device: null };

        // Build sources map from project
        const sources: SourceMetadata[] = [renderProject.screenSource];
        if (renderProject.cameraSource) {
            sources.push(renderProject.cameraSource);
        }

        let totalDurationMs = 0;
        let totalFrames = 0;
        let framesProcessed = 0;

        try {
            onProgress({ progress: 0, timeRemainingSeconds: null, phase: 'preparing' });

            const timeMapper = new TimeMapper(renderProject.timeline.outputWindows);
            totalDurationMs = timeMapper.outputDuration;
            const totalDurationSec = totalDurationMs / 1000;
            const mediaUrls = env?.mediaUrls ?? {};

            const loadImages = async () => {
                const bgSettings = renderProject.settings.background;
                const bgUrl = (bgSettings.type === 'preset' || bgSettings.type === 'custom')
                    ? (bgSettings.storagePath && mediaUrls[bgSettings.storagePath]) || bgSettings.imageUrl
                    : undefined;
                const deviceFrameSettings = renderProject.settings.screen;
                const frameDef = deviceFrameSettings.mode === 'device' && deviceFrameSettings.deviceFrameId
                    ? getDeviceFrame(deviceFrameSettings.deviceFrameId)
                    : undefined;

                await Promise.all([
                    renderProject.settings.screen.toolbar.enabled && preloadToolbarIcons(renderCtx),
                    bgUrl && (async () => {
                        console.log(`[Export] Loading background image: ${bgUrl}`);
                        const bgStart = performance.now();
                        imageElements.bg = await renderCtx.loadImage(bgUrl);
                        console.log(`[Export] Background image loaded in ${(performance.now() - bgStart).toFixed(0)}ms`);
                    })(),
                    frameDef && (async () => {
                        console.log(`[Export] Loading device frame: ${frameDef.imageUrl}`);
                        const dfStart = performance.now();
                        imageElements.device = await renderCtx.loadImage(frameDef.imageUrl);
                        console.log(`[Export] Device frame loaded in ${(performance.now() - dfStart).toFixed(0)}ms`);
                    })(),
                ]);
            };

            const initExtractors = async () => {
                const toInit = sources.filter(s => mediaUrls[s.storagePath]);
                const progressBySource = toInit.map(() => 0);
                await Promise.all(toInit.map(async (source, si) => {
                    const sourceUrl = mediaUrls[source.storagePath];
                    console.log(`[Export] Initializing extractor for: ${sourceUrl}`);
                    const extractor = new FrameExtractor(sourceUrl, env?.decodePreferences);
                    // Register before init so `finally` disposes it even if a sibling init fails
                    frameExtractors[source.storagePath] = extractor;
                    await extractor.initialize((chunkProgress) => {
                        progressBySource[si] = chunkProgress;
                        const overallProgress = progressBySource.reduce((sum, p) => sum + p, 0) / toInit.length;
                        onProgress({ progress: overallProgress, timeRemainingSeconds: null, phase: 'preparing' });
                    });
                }));
            };

            // Images, frame extractors and audio are independent — prepare them concurrently
            const setupStart = performance.now();
            const setupMs: Record<string, number> = {};
            const timed = async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
                const t0 = performance.now();
                const result = await fn();
                setupMs[label] = performance.now() - t0;
                return result;
            };
            const [, , , renderedAudioBuffer] = await Promise.all([
                timed('images', loadImages),
                timed('fonts', () => preloadFonts(renderProject)),
                timed('extractors', initExtractors),
                timed('audio', () => renderAudioBuffer({
                    project: renderProject,
                    totalDurationSec,
                    userEvents: renderProject.userEvents,
                    timeMapper,
                    soundEffects: env?.soundEffects,
                    mediaUrls,
                })),
            ]);
            console.log(`[Export] Setup done in ${(performance.now() - setupStart).toFixed(0)}ms ` +
                `(images=${setupMs.images.toFixed(0)}ms fonts=${setupMs.fonts.toFixed(0)}ms ` +
                `extractors=${setupMs.extractors.toFixed(0)}ms audio=${setupMs.audio.toFixed(0)}ms, run concurrently)`);

            // Check decode fallback
            let decodeFallbackTriggered = false;
            const decodeFallbackOccurred = Object.values(frameExtractors).some(ext => ext.isSoftwareDecode);
            if (decodeFallbackOccurred) {
                const userChoseGpu = (env?.videoDecodePreference ?? 'gpu') === 'gpu';
                if (userChoseGpu) {
                    decodeFallbackTriggered = true;
                    env?.onDecodeFallback?.();
                    onProgress({ progress: 1, timeRemainingSeconds: null, phase: 'preparing', decodeFallback: true });
                }
            }

            encodeAudioBuffer(renderedAudioBuffer, audioEncoder);

            // --- Frame Loop ---
            onProgress({ progress: 0, timeRemainingSeconds: null, phase: 'exporting' });
            const frameInterval = 1000 / fps;
            totalFrames = Math.ceil(totalDurationMs / frameInterval);
            const variableFrameRate = (options?.frameRateMode ?? 'variable') === 'variable';
            const verifySkips = variableFrameRate && !!options?.verifySkippedFrames;
            console.log(`[Export] Starting frame loop: ${totalFrames} frames, ${totalDurationMs.toFixed(0)}ms duration, ` +
                `${Object.keys(frameExtractors).length} sources, ${fps}fps ${variableFrameRate ? 'variable' : 'constant'}${verifySkips ? ' (verify)' : ''}`);

            const startTime = performance.now();
            framesProcessed = 0;

            // Timing accumulators — log every 30 frames for short videos, 150 for long ones
            const logInterval = totalDurationMs > 15_000 ? 150 : 30;
            let accDecode = 0, accBackground = 0, accRender = 0, accEncode = 0, accBackpressure = 0, accTotal = 0;
            let accChunksFed = 0, maxQueueSize = 0;
            let accUnchangedFrames = 0;
            let accRenderedFrames = 0, accEncodedFrames = 0;

            // VFR state: the signature of the image currently on the canvas, and when it was last encoded
            let lastSignature: string | null = null;
            let lastEncodedTimeMs = -Infinity;
            let lastKeyframeTimeMs = -Infinity;
            let encodedFrames = 0;
            let longestHoldMs = 0;
            let verifyMismatches = 0;
            let lastDrawnPixels: Uint8ClampedArray | null = null;

            // Track frames with unchanged decoded timestamps
            const prevTimestamps: Record<string, number> = {};
            let unchangedStreakCount = 0;
            let totalUnchangedFrames = 0;

            for (let i = 0; i < totalFrames; i++) {
                if (signal.aborted) throw new Error("Export cancelled");

                const frameStart = performance.now();
                const currentTimeMs = i * frameInterval;
                const timestampMicros = i * (1000000 / fps);

                // Update Progress (every 150 frames)
                framesProcessed++;
                if (framesProcessed % 150 === 0 || framesProcessed === totalFrames) {
                    const elapsedTime = (performance.now() - startTime) / 1000;
                    const fpsRate = framesProcessed / elapsedTime;
                    const remainingFrames = totalFrames - framesProcessed;
                    const timeRemaining = remainingFrames / fpsRate;

                    onProgress({
                        progress: framesProcessed / totalFrames,
                        timeRemainingSeconds: timeRemaining,
                        framesProcessed,
                        totalFrames,
                    });
                }

                const sourceTimeMs = timeMapper.mapOutputToSourceTime(currentTimeMs);

                // Decode frames at the target source time
                const t0 = performance.now();
                const currentFrameRefs: Record<string, VideoFrame> = {};
                await Promise.all(Object.entries(frameExtractors).map(async ([id, ext]) => {
                    currentFrameRefs[id] = await ext.getFrameAtTime(sourceTimeMs / 1000);
                }));
                const t1 = performance.now();
                for (const ext of Object.values(frameExtractors)) {
                    accChunksFed += ext.lastChunksFed;
                }

                // Check if all decoded frame timestamps are unchanged from previous frame
                let allUnchanged = i > 0;
                for (const [id, frame] of Object.entries(currentFrameRefs)) {
                    if (prevTimestamps[id] !== frame.timestamp) {
                        allUnchanged = false;
                        prevTimestamps[id] = frame.timestamp;
                    }
                }

                if (allUnchanged) {
                    unchangedStreakCount++;
                    totalUnchangedFrames++;
                    accUnchangedFrames++;
                } else {
                    unchangedStreakCount = 0;
                }

                // VFR: a frame whose signature matches the image on the canvas is identical to it —
                // don't redraw it, and only encode it when a hold expires or it's the first/last frame
                let shouldDraw = true;
                let shouldEncode = true;
                let signature: string | null = null;
                if (variableFrameRate) {
                    signature = computeFrameSignature({
                        project: renderProject,
                        projectName,
                        userEvents: renderProject.userEvents,
                        timeMapper,
                        currentTimeMs,
                        frameRefs: currentFrameRefs,
                    });
                    const unchanged = signature === lastSignature;
                    shouldDraw = !unchanged;
                    shouldEncode = !unchanged
                        || i === 0
                        || i === totalFrames - 1 // its own duration ends the track
                        || currentTimeMs - lastEncodedTimeMs >= MAX_FRAME_HOLD_MS;
                }
                const verifyThisFrame = verifySkips && !shouldDraw;

                // Render Frame
                if (shouldDraw || verifyThisFrame) {
                    ctx.clearRect(0, 0, width, height);

                    const tBg0 = performance.now();
                    drawBackground(
                        ctx,
                        renderProject.settings.background,
                        renderProject.settings.background.backgroundBlurPx,
                        { width, height },
                        imageElements.bg
                    );
                    accBackground += performance.now() - tBg0;

                    PlaybackRenderer.render({
                        ctx,
                        renderCtx,
                        bgRef: imageElements.bg,
                        videoRefs: currentFrameRefs,
                        deviceFrameImg: imageElements.device,
                        sourceCanvas: offscreenCanvas
                    }, {
                        project: renderProject,
                        projectName,
                        userEvents: renderProject.userEvents,
                        currentTimeMs: currentTimeMs,
                        timeMapper: timeMapper
                    });
                    accRenderedFrames++;
                }

                if (shouldDraw) {
                    lastSignature = signature;
                    if (verifySkips) lastDrawnPixels = ctx.getImageData(0, 0, width, height).data;
                } else if (verifyThisFrame && lastDrawnPixels) {
                    const pixels = ctx.getImageData(0, 0, width, height).data;
                    let diffPixels = 0;
                    for (let p = 0; p < pixels.length; p += 4) {
                        if (pixels[p] !== lastDrawnPixels[p] || pixels[p + 1] !== lastDrawnPixels[p + 1]
                            || pixels[p + 2] !== lastDrawnPixels[p + 2] || pixels[p + 3] !== lastDrawnPixels[p + 3]) {
                            diffPixels++;
                        }
                    }
                    if (diffPixels > 0) {
                        verifyMismatches++;
                        if (verifyMismatches <= MAX_LOGGED_MISMATCHES) {
                            console.warn(`[Export:VFR] MISMATCH t=${currentTimeMs.toFixed(0)}ms diffPixels=${diffPixels} signature=${signature}`);
                        }
                        // Keep comparing against what's actually on the canvas now
                        lastDrawnPixels = pixels;
                    }
                }
                const t2 = performance.now();

                if (shouldEncode) {
                    const durationMicros = 1000000 / fps;
                    const encoderFrame = new VideoFrame(offscreenCanvas, {
                        timestamp: timestampMicros,
                        duration: durationMicros
                    });

                    if ((videoEncoder.state as string) === 'closed') {
                        encoderFrame.close();
                        Object.values(currentFrameRefs).forEach(f => f.close());
                        const err = videoEncoderError
                            ?? new Error(`VideoEncoder closed unexpectedly after ${framesProcessed}/${totalFrames} frames`);
                        throw err;
                    }
                    const keyFrame = variableFrameRate
                        ? currentTimeMs - lastKeyframeTimeMs >= KEYFRAME_INTERVAL_MS
                        : i % (fps * 2) === 0;
                    if (keyFrame) lastKeyframeTimeMs = currentTimeMs;
                    if (i > 0) longestHoldMs = Math.max(longestHoldMs, currentTimeMs - lastEncodedTimeMs);
                    lastEncodedTimeMs = currentTimeMs;
                    encodedFrames++;
                    accEncodedFrames++;

                    videoEncoder.encode(encoderFrame, { keyFrame });
                    encoderFrame.close();
                }
                const t3 = performance.now();

                Object.values(currentFrameRefs).forEach(f => f.close());

                // Backpressure
                maxQueueSize = Math.max(maxQueueSize, videoEncoder.encodeQueueSize);
                const bpStart = performance.now();
                while ((videoEncoder.state as string) !== 'closed' && videoEncoder.encodeQueueSize > 15) {
                    if (performance.now() - bpStart > BACKPRESSURE_TIMEOUT_MS) {
                        console.error(`[Export] Backpressure timeout after ${BACKPRESSURE_TIMEOUT_MS}ms (queueSize=${videoEncoder.encodeQueueSize})`);
                        throw videoEncoderError
                        ?? new Error(`VideoEncoder backpressure stalled (queueSize=${videoEncoder.encodeQueueSize}) after ${framesProcessed}/${totalFrames} frames`);
                    }
                    await new Promise(r => setTimeout(r, 1));
                }
                const t4 = performance.now();

                accDecode += t1 - t0;
                accRender += t2 - t1;
                accEncode += t3 - t2;
                accBackpressure += t4 - t3;
                accTotal += t4 - frameStart;

                // Per-frame timing breakdown
                if (framesProcessed % logInterval === 0) {
                    const mem = (performance as any).memory;
                    const memStr = mem
                        ? ` heap=${(mem.usedJSHeapSize / 1024 / 1024).toFixed(0)}/${(mem.jsHeapSizeLimit / 1024 / 1024).toFixed(0)}MB`
                        : '';
                    const newFrames = logInterval - accUnchangedFrames;
                    console.log(`[Export] Frames ${framesProcessed - logInterval + 1}-${framesProcessed}/${totalFrames}: ` +
                        `decode=${accDecode.toFixed(0)}ms render=${accRender.toFixed(0)}ms ` +
                        `encode=${accEncode.toFixed(0)}ms backpressure=${accBackpressure.toFixed(0)}ms ` +
                        `total=${accTotal.toFixed(0)}ms (${(accTotal / logInterval).toFixed(0)}ms/frame) ` +
                        `decoded=${newFrames}/${logInterval} encoded=${accEncodedFrames}/${logInterval} ` +
                        `chunksFed=${accChunksFed} maxQueue=${maxQueueSize}${memStr}`);
                    const profile = PlaybackRenderer.flushProfile(accRenderedFrames);
                    if (profile) console.log(`${profile} background=${accBackground.toFixed(0)}ms`);
                    accDecode = 0; accBackground = 0; accRender = 0; accEncode = 0; accBackpressure = 0; accTotal = 0;
                    accChunksFed = 0; maxQueueSize = 0; accUnchangedFrames = 0;
                    accRenderedFrames = 0; accEncodedFrames = 0;
                }

                // Periodic yield for UI responsiveness
                if (framesProcessed % logInterval === 0) {
                    await new Promise(r => setTimeout(r, 0));
                }
            }

            console.log(`[Export] Frame loop done in ${((performance.now() - startTime) / 1000).toFixed(1)}s (${totalFrames} frames)`);
            if (variableFrameRate) {
                const skippedPct = totalFrames > 0 ? (1 - encodedFrames / totalFrames) * 100 : 0;
                console.log(`[Export] VFR: encoded ${encodedFrames}/${totalFrames} frames (${skippedPct.toFixed(0)}% skipped), ` +
                    `longest hold ${longestHoldMs.toFixed(0)}ms${verifySkips ? `, verify mismatches ${verifyMismatches}` : ''}`);
            }



            if ((videoEncoder.state as string) !== 'closed') {
                await videoEncoder.flush();
            } else {
                throw videoEncoderError
                ?? new Error('VideoEncoder closed unexpectedly before flush');
            }
            if (audioEncoder.state !== 'closed') {
                await audioEncoder.flush();
            } else {
                console.warn('[Export] Audio encoder closed unexpectedly — video may have no audio');
            }
            muxer.finalize();

            // Assemble final MP4 blob only if we buffered in memory
            let blob: Blob | null = null;
            if (!streaming) {
                const totalSize = muxedChunks.reduce((max, c) => Math.max(max, c.position + c.data.byteLength), 0);
                const finalBuffer = new Uint8Array(totalSize);
                for (const chunk of muxedChunks) {
                    finalBuffer.set(chunk.data, chunk.position);
                }
                muxedChunks.length = 0;
                blob = new Blob([finalBuffer], { type: 'video/mp4' });
            }

            const usedSoftwareDecode = Object.values(frameExtractors).some(ext => ext.isSoftwareDecode);

            return {
                blob,
                codecs: {
                    video: {
                        encoder: videoCodec.config.codec,
                        muxer: videoCodec.muxerCodec,
                        fallback: videoCodec.fallback,
                        tried: videoCodec.tried,
                    },
                    audio: {
                        encoder: audioCodec.encoderCodec,
                        muxer: audioCodec.muxerCodec,
                        fallback: audioCodec.fallback,
                    },
                },
                videoDecodeMode: usedSoftwareDecode ? 'software' : 'hardware',
                videoDecodeFallback: decodeFallbackTriggered,
            };

        } catch (e) {
            if (signal.aborted) {
                throw new Error('Export cancelled');
            }
            throw e;
        } finally {
            Object.values(frameExtractors).forEach(ext => ext.dispose());
        }
    }

    cancel() {
        if (this.abortController) {
            this.abortController.abort();
        }
    }
}

/** Give up waiting on font loads after this long — the export proceeds with fallback fonts. */
const FONT_LOAD_TIMEOUT_MS = 5000;

/**
 * Loads the web fonts the painters draw text with. Without this, a font that's
 * still loading when the export starts is drawn as a fallback for the first
 * frames (and, with VFR, such a frame can be held).
 */
async function preloadFonts(project: Project): Promise<void> {
    const fonts = (globalThis as { document?: Document }).document?.fonts;
    if (!fonts) return;

    // Size doesn't matter for loading — family + weight select the font face
    const specs = new Set<string>([getCaptionFont(16), getKeyboardFont(16)]);
    for (const segment of project.timeline.overlaySegments || []) {
        if (segment.item.type === 'text') specs.add(getOverlayTextFont({ ...segment.item, fontSizePx: 16 }));
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>(resolve => {
        timer = setTimeout(() => {
            console.warn(`[Export] Font loading still pending after ${FONT_LOAD_TIMEOUT_MS}ms — continuing`);
            resolve();
        }, FONT_LOAD_TIMEOUT_MS);
    });
    const loads = Promise.all([...specs].map(spec =>
        fonts.load(spec).catch(e => console.warn(`[Export] Failed to load font "${spec}":`, e))
    ));
    await Promise.race([loads, timeout]);
    clearTimeout(timer);
}

/**
 * Detect whether an error is a codec reclaim / quota exceeded error.
 */
function isCodecReclaimError(error: Error): boolean {
    const msg = error.message.toLowerCase();
    return (
        error.name === 'QuotaExceededError' ||
        msg.includes('codec reclaimed') ||
        msg.includes('quotaexceedederror') ||
        msg.includes('backpressure stalled') ||
        msg.includes('decoder closed') ||
        msg.includes('max rebuilds exceeded')
    );
}
