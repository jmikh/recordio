import * as Mp4Muxer from 'mp4-muxer';
import { scaleProject } from '../utils/projectScale';
import { PlaybackRenderer } from './PlaybackRenderer';
import { drawBackground } from '../painters/backgroundPainter';

import { getDeviceFrame } from '../utils/deviceFrames';
import { TimeMapper } from '../mappers/timeMapper';
import { FrameExtractor, type DecodePreferences } from './FrameExtractor';
import { resolveVideoCodec, resolveAudioCodec, getHeightForQuality } from './codecResolver';
import { renderAudioBuffer, encodeAudioBuffer, type SoundEffectBuffers } from './audioProcessor';
import type { Project, SourceMetadata } from '../types';
import type { RenderContext } from '../utils/renderContext';

export type { ExportQuality } from './codecResolver';

export interface ExportProgress {
    progress: number;
    timeRemainingSeconds: number | null;
    phase?: 'preparing' | 'exporting' | 'uploading';
    decodeFallback?: boolean;
}

export interface ExportCodecInfo {
    video: { encoder: string; muxer: string; fallback: boolean; tried: string[] };
    audio: { encoder: string; muxer: string; fallback: boolean };
}

export interface ExportResult {
    blob: Blob;
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
}

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
        options?: { skipDownload?: boolean },
        env?: ExportEnvironment,
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
                const result = await this.runExport(project, quality, onProgress, signal, options, env);
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
        options?: { skipDownload?: boolean },
        env?: ExportEnvironment,
    ): Promise<ExportResult> {
        const renderCtx = env?.renderContext;
        if (!renderCtx) {
            throw new Error('[ExportManager] renderContext is required in ExportEnvironment');
        }

        const fps = 30;
        const targetHeight = getHeightForQuality(quality);
        const aspectRatio = project.settings.outputSize.width / project.settings.outputSize.height;
        const targetWidth = Math.round(targetHeight * aspectRatio);

        // Ensure even dimensions for encoder compatibility
        const width = targetWidth % 2 === 0 ? targetWidth : targetWidth + 1;
        const height = targetHeight % 2 === 0 ? targetHeight : targetHeight + 1;

        const renderProject = scaleProject(project, { width, height });

        // Probe codec support
        const videoCodec = await resolveVideoCodec(quality, width, height);
        const audioCodec = await resolveAudioCodec();

        // Stream muxer output into a growable chunk list
        const muxedChunks: { data: Uint8Array; position: number }[] = [];
        const muxer = new Mp4Muxer.Muxer({
            target: new Mp4Muxer.StreamTarget({
                onData: (data, position) => {
                    muxedChunks.push({ data, position });
                },
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
            const bgSettings = renderProject.settings.background;
            if (bgSettings.type === 'preset' || bgSettings.type === 'custom') {
                const bgUrl = bgSettings.customRuntimeUrl || bgSettings.imageUrl;
                if (bgUrl) {
                    console.log(`[Export] Loading background image: ${bgUrl}`);
                    const bgStart = performance.now();
                    imageElements.bg = await renderCtx.loadImage(bgUrl);
                    console.log(`[Export] Background image loaded in ${(performance.now() - bgStart).toFixed(0)}ms`);
                }
            }

            const deviceFrameSettings = renderProject.settings.screen;
            if (deviceFrameSettings.mode === 'device' && deviceFrameSettings.deviceFrameId) {
                const frameDef = getDeviceFrame(deviceFrameSettings.deviceFrameId);
                if (frameDef) {
                    console.log(`[Export] Loading device frame: ${frameDef.imageUrl}`);
                    const dfStart = performance.now();
                    imageElements.device = await renderCtx.loadImage(frameDef.imageUrl);
                    console.log(`[Export] Device frame loaded in ${(performance.now() - dfStart).toFixed(0)}ms`);
                }
            }

            // Signal preparing phase
            console.log(`[Export] Image loading complete, initializing frame extractors...`);
            onProgress({ progress: 0, timeRemainingSeconds: null, phase: 'preparing' });

            // Initialize frame extractors
            const sourceCount = sources.filter(s => s.runtimeUrl).length;
            let sourceIndex = 0;
            for (const source of sources) {
                if (source.runtimeUrl) {
                    console.log(`[Export] Initializing extractor for: ${source.runtimeUrl}`);
                    const extractor = new FrameExtractor(source.runtimeUrl, env?.decodePreferences);
                    const si = sourceIndex;
                    await extractor.initialize((chunkProgress) => {
                        const overallProgress = (si + chunkProgress) / sourceCount;
                        onProgress({ progress: overallProgress, timeRemainingSeconds: null, phase: 'preparing' });
                    });
                    frameExtractors[source.id] = extractor;
                    sourceIndex++;
                }
            }

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

            const timeMapper = new TimeMapper(renderProject.timeline.outputWindows);
            totalDurationMs = timeMapper.outputDuration;
            const totalDurationSec = totalDurationMs / 1000;

            // --- Audio Rendering ---
            const renderedAudioBuffer = await renderAudioBuffer({
                project: renderProject,
                totalDurationSec,
                userEvents: renderProject.userEvents,
                timeMapper,
                soundEffects: env?.soundEffects,
            });
            encodeAudioBuffer(renderedAudioBuffer, audioEncoder);

            // --- Frame Loop ---
            onProgress({ progress: 0, timeRemainingSeconds: null, phase: 'exporting' });
            const frameInterval = 1000 / fps;
            totalFrames = Math.ceil(totalDurationMs / frameInterval);
            console.log(`[Export] Starting frame loop: ${totalFrames} frames, ${totalDurationMs.toFixed(0)}ms duration, ${Object.keys(frameExtractors).length} sources`);

            const startTime = performance.now();
            framesProcessed = 0;

            // Timing accumulators (reset every 30 frames for logging)
            let accDecode = 0, accRender = 0, accEncode = 0, accBackpressure = 0, accTotal = 0;

            for (let i = 0; i < totalFrames; i++) {
                if (signal.aborted) throw new Error("Export cancelled");

                const frameStart = performance.now();
                const currentTimeMs = i * frameInterval;
                const timestampMicros = i * (1000000 / fps);

                // Update Progress (every 30 frames)
                framesProcessed++;
                if (framesProcessed % 30 === 0 || framesProcessed === totalFrames) {
                    const elapsedTime = (performance.now() - startTime) / 1000;
                    const fpsRate = framesProcessed / elapsedTime;
                    const remainingFrames = totalFrames - framesProcessed;
                    const timeRemaining = remainingFrames / fpsRate;

                    onProgress({
                        progress: framesProcessed / totalFrames,
                        timeRemainingSeconds: timeRemaining
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

                // Render Frame
                ctx.clearRect(0, 0, width, height);

                drawBackground(
                    ctx,
                    renderProject.settings.background,
                    renderProject.settings.background.backgroundBlurPx,
                    { width, height },
                    imageElements.bg
                );

                PlaybackRenderer.render({
                    ctx,
                    renderCtx,
                    bgRef: imageElements.bg,
                    videoRefs: currentFrameRefs,
                    deviceFrameImg: imageElements.device,
                    sourceCanvas: offscreenCanvas
                }, {
                    project: renderProject,
                    userEvents: renderProject.userEvents,
                    currentTimeMs: currentTimeMs,
                    timeMapper: timeMapper
                });
                const t2 = performance.now();

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
                videoEncoder.encode(encoderFrame, { keyFrame: i % (fps * 2) === 0 });
                encoderFrame.close();
                const t3 = performance.now();

                Object.values(currentFrameRefs).forEach(f => f.close());

                // Backpressure
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

                // Per-frame timing breakdown (every 30 frames)
                if (framesProcessed % 30 === 0) {
                    console.log(`[Export] Frames ${framesProcessed - 29}-${framesProcessed}/${totalFrames}: ` +
                        `decode=${accDecode.toFixed(0)}ms render=${accRender.toFixed(0)}ms ` +
                        `encode=${accEncode.toFixed(0)}ms backpressure=${accBackpressure.toFixed(0)}ms ` +
                        `total=${accTotal.toFixed(0)}ms (${(accTotal / 30).toFixed(0)}ms/frame)`);
                    const profile = PlaybackRenderer.flushProfile(30);
                    if (profile) console.log(profile);
                    accDecode = 0; accRender = 0; accEncode = 0; accBackpressure = 0; accTotal = 0;
                }

                // Periodic yield for UI responsiveness
                if (framesProcessed % 30 === 0) {
                    await new Promise(r => setTimeout(r, 0));
                }
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

            // Assemble final MP4 from streamed chunks
            const totalSize = muxedChunks.reduce((max, c) => Math.max(max, c.position + c.data.byteLength), 0);
            const finalBuffer = new Uint8Array(totalSize);
            for (const chunk of muxedChunks) {
                finalBuffer.set(chunk.data, chunk.position);
            }
            muxedChunks.length = 0;
            const blob = new Blob([finalBuffer], { type: 'video/mp4' });

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
