import * as Mp4Muxer from 'mp4-muxer';
import * as Sentry from '@sentry/react';
import { ProjectImpl } from '../../core/Project';
import { PlaybackRenderer } from '../components/canvas/PlaybackRenderer';
import { drawBackground } from '../../core/painters/backgroundPainter';

import { getDeviceFrame } from '../../core/deviceFrames';
import { TimeMapper } from '../../core/mappers/timeMapper';
import { FrameExtractor } from './FrameExtractor';
import { resolveVideoCodec, resolveAudioCodec, getHeightForQuality } from './codecResolver';
import { renderAudioBuffer, encodeAudioBuffer } from './audioProcessor';
import type { Project, SourceMetadata } from '../../types';
import { downloadViaNative } from '../../bridge/macBridge';
import { useUIStore } from '../stores/useUIStore';


// Re-export types that consumers depend on
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
        options?: { skipDownload?: boolean }
    ): Promise<ExportResult> {
        this.abortController = new AbortController();
        const signal = this.abortController.signal;

        let lastError: Error | null = null;

        for (let attempt = 0; attempt <= MAX_EXPORT_RETRIES; attempt++) {
            if (signal.aborted) throw new Error("Export cancelled");

            if (attempt > 0) {
                console.warn(`[Export] Retrying export (attempt ${attempt + 1}/${MAX_EXPORT_RETRIES + 1})`);
                Sentry.addBreadcrumb({
                    category: 'codec',
                    message: `Export retry attempt ${attempt + 1} after codec error`,
                    level: 'warning',
                    data: { previousError: lastError?.message },
                });
                // Reset progress for retry
                onProgress({ progress: 0, timeRemainingSeconds: null });
            }

            try {
                const result = await this.runExport(project, quality, onProgress, signal, options);
                return result;
            } catch (e) {
                if (signal.aborted) throw new Error('Export cancelled');

                const error = e instanceof Error ? e : new Error(String(e));

                if (isCodecReclaimError(error) && attempt < MAX_EXPORT_RETRIES) {
                    console.warn('[Export] Codec reclaimed — scheduling retry:', error.message);
                    Sentry.withScope((scope) => {
                        scope.setTag('codec.reclaim', 'true');
                        scope.setTag('export.retry_attempt', String(attempt + 1));
                        scope.setLevel('warning');
                        Sentry.captureMessage(`Codec reclaimed during export — retrying (attempt ${attempt + 1})`);
                    });
                    lastError = error;
                    // Small delay before retry to let browser reclaim settle
                    await new Promise(r => setTimeout(r, 500));
                    continue;
                }

                // Not a codec reclaim error or max retries exceeded — rethrow
                throw e;
            }
        }

        // Should not reach here, but safety net
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
        options?: { skipDownload?: boolean }
    ): Promise<ExportResult> {
        const fps = 30;
        const targetHeight = getHeightForQuality(quality);
        const aspectRatio = project.settings.outputSize.width / project.settings.outputSize.height;
        const targetWidth = Math.round(targetHeight * aspectRatio);

        // Ensure even dimensions for encoder compatibility
        const width = targetWidth % 2 === 0 ? targetWidth : targetWidth + 1;
        const height = targetHeight % 2 === 0 ? targetHeight : targetHeight + 1;

        const renderProject = ProjectImpl.scale(project, { width, height });

        // Probe codec support: prefer H.264, fall back to VP9; prefer AAC, fall back to Opus
        const videoCodec = await resolveVideoCodec(quality, width, height);
        const audioCodec = await resolveAudioCodec();

        // Stream muxer output into a growable chunk list instead of a single
        // ArrayBuffer. This avoids mp4-muxer's internal double-buffering during
        // finalize, which can OOM on long videos (e.g., 8+ min on Opera/Windows).
        // fastStart: false puts moov at file end — fine since the output is
        // downloaded or uploaded, never streamed for live playback.
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
        const imageElements: { bg: HTMLImageElement | null, device: HTMLImageElement | null } = { bg: null, device: null };

        const loadImage = (url: string) => new Promise<HTMLImageElement>((resolve, reject) => {
            const img = new Image();
            // Only set crossOrigin for external URLs, not blob: URLs
            if (!url.startsWith('blob:')) {
                img.crossOrigin = 'anonymous';
            }
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = url;
        });

        // Build sources map from project
        const sources: SourceMetadata[] = [renderProject.screenSource];
        if (renderProject.cameraSource) {
            sources.push(renderProject.cameraSource);
        }

        // Tracking variables — hoisted for Sentry context in catch block
        let totalDurationMs = 0;
        let totalFrames = 0;
        let framesProcessed = 0;

        try {
            const bgSettings = renderProject.settings.background;
            if (bgSettings.type === 'preset' || bgSettings.type === 'custom') {
                // Prefer customRuntimeUrl (uploaded), fallback to imageUrl (preset)
                const bgUrl = bgSettings.customRuntimeUrl || bgSettings.imageUrl;
                if (bgUrl) {
                    imageElements.bg = await loadImage(bgUrl);
                }
            }

            const deviceFrameSettings = renderProject.settings.screen;
            if (deviceFrameSettings.mode === 'device' && deviceFrameSettings.deviceFrameId) {
                const frameDef = getDeviceFrame(deviceFrameSettings.deviceFrameId);
                if (frameDef) {
                    imageElements.device = await loadImage(frameDef.imageUrl);
                }
            }

            // Signal preparing phase — WASM compilation + full demux happen here
            onProgress({ progress: 0, timeRemainingSeconds: null, phase: 'preparing' });

            // Initialize frame extractors for screen and camera sources
            const sourceCount = sources.filter(s => s.runtimeUrl).length;
            let sourceIndex = 0;
            for (const source of sources) {
                if (source.runtimeUrl) {
                    const extractor = new FrameExtractor(source.runtimeUrl);
                    const si = sourceIndex;
                    await extractor.initialize((chunkProgress) => {
                        // Each source gets an equal share of the preparing progress bar
                        const overallProgress = (si + chunkProgress) / sourceCount;
                        onProgress({ progress: overallProgress, timeRemainingSeconds: null, phase: 'preparing' });
                    });
                    frameExtractors[source.id] = extractor;
                    sourceIndex++;
                }
            }

            // If any extractor fell back to software decode AND user had GPU selected, notify the UI
            let decodeFallbackTriggered = false;
            const decodeFallbackOccurred = Object.values(frameExtractors).some(ext => ext.isSoftwareDecode);
            if (decodeFallbackOccurred) {
                const userChoseGpu = useUIStore.getState().videoDecodePreference === 'gpu';
                if (userChoseGpu) {
                    decodeFallbackTriggered = true;
                    useUIStore.getState().setVideoDecodePreference('cpu');
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
            });
            encodeAudioBuffer(renderedAudioBuffer, audioEncoder);

            // --- Frame Loop ---
            onProgress({ progress: 0, timeRemainingSeconds: null, phase: 'exporting' });
            const frameInterval = 1000 / fps;
            totalFrames = Math.ceil(totalDurationMs / frameInterval);

            const startTime = performance.now();
            framesProcessed = 0;

            for (let i = 0; i < totalFrames; i++) {
                if (signal.aborted) throw new Error("Export cancelled");

                const currentTimeMs = i * frameInterval;
                const timestampMicros = i * (1000000 / fps);

                // Update Progress (every 30 frames to avoid excessive store updates)
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

                // Decode frames at the target source time using WebCodecs
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
                    offscreenCanvas as unknown as HTMLCanvasElement,
                    imageElements.bg
                );

                PlaybackRenderer.render({
                    canvas: offscreenCanvas as unknown as HTMLCanvasElement,
                    ctx,
                    bgRef: imageElements.bg,
                    videoRefs: currentFrameRefs,
                    deviceFrameImg: imageElements.device
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

                // Close decoded source frames — they've been drawn to the canvas
                Object.values(currentFrameRefs).forEach(f => f.close());
                const t3 = performance.now();

                // Backpressure: wait for the encoder queue to drain before submitting more.
                const bpStart = performance.now();
                while ((videoEncoder.state as string) !== 'closed' && videoEncoder.encodeQueueSize > 5) {
                    if (performance.now() - bpStart > BACKPRESSURE_TIMEOUT_MS) {
                        console.error(`[Export] Backpressure timeout after ${BACKPRESSURE_TIMEOUT_MS}ms (queueSize=${videoEncoder.encodeQueueSize})`);
                        throw videoEncoderError
                        ?? new Error(`VideoEncoder backpressure stalled (queueSize=${videoEncoder.encodeQueueSize}) after ${framesProcessed}/${totalFrames} frames`);
                    }
                    await new Promise(r => setTimeout(r, 1));
                }
                const bpMs = performance.now() - bpStart;

                // Per-frame timing breakdown (every 30 frames)
                if (framesProcessed % 30 === 0) {
                    const frameTotal = performance.now() - t0;
                    console.log(`[Export] Frame ${framesProcessed}/${totalFrames}: ` +
                        `${frameTotal.toFixed(0)}ms total | ` +
                        `extract=${(t1 - t0).toFixed(0)}ms, render=${(t2 - t1).toFixed(0)}ms, ` +
                        `encode=${(t3 - t2).toFixed(0)}ms, backpressure=${bpMs.toFixed(0)}ms, ` +
                        `queueSize=${videoEncoder.encodeQueueSize}`);
                }

                // Periodic yield for UI responsiveness (progress bar, cancel button)
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

            // Assemble final MP4 from streamed chunks. StreamTarget may write
            // non-sequentially (position arg), so we stitch respecting offsets.
            const totalSize = muxedChunks.reduce((max, c) => Math.max(max, c.position + c.data.byteLength), 0);
            const finalBuffer = new Uint8Array(totalSize);
            for (const chunk of muxedChunks) {
                finalBuffer.set(chunk.data, chunk.position);
            }
            muxedChunks.length = 0; // free chunk list immediately
            const blob = new Blob([finalBuffer], { type: 'video/mp4' });

            if (!options?.skipDownload) {
                this.downloadBlob(blob, `${project.name}_${quality}.mp4`);
            }

            // Flag abnormally slow exports (>2× output duration)
            const exportElapsedMs = performance.now() - startTime;
            if (exportElapsedMs > totalDurationMs * 2) {
                Sentry.withScope((scope) => {
                    scope.setLevel('warning');
                    scope.setTag('export.quality', quality);
                    scope.setTag('export.fps', String(fps));
                    scope.setExtra('outputDurationMs', totalDurationMs);
                    scope.setExtra('exportElapsedMs', Math.round(exportElapsedMs));
                    scope.setExtra('ratio', (exportElapsedMs / totalDurationMs).toFixed(2));
                    scope.setExtra('totalFrames', totalFrames);
                    Sentry.captureMessage(
                        `Slow export: ${quality} ${fps}fps took ${(exportElapsedMs / totalDurationMs).toFixed(1)}× output duration`
                    );
                });
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
            Sentry.withScope((scope) => {
                scope.setTag('export.quality', quality);
                scope.setTag('export.fps', String(fps));
                scope.setExtra('outputDurationMs', totalDurationMs);
                scope.setExtra('framesProcessed', framesProcessed);
                scope.setExtra('totalFrames', totalFrames);
                Sentry.captureException(e instanceof Error ? e : new Error(String(e)));
            });
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

    private async downloadBlob(blob: Blob, filename: string) {
        // In Mac app: use native save dialog via Swift bridge
        const sentToNative = await downloadViaNative(blob, filename);
        if (sentToNative) return;

        // Browser fallback: standard anchor download
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    private getTotalDuration(project: Project): number {
        const timeMapper = new TimeMapper(project.timeline.outputWindows);
        return timeMapper.outputDuration;
    }
}

/**
 * Detect whether an error is a codec reclaim / quota exceeded error.
 * These occur when Chrome reclaims codec resources due to inactivity
 * (e.g., background tab, memory pressure).
 */
function isCodecReclaimError(error: Error): boolean {
    const msg = error.message.toLowerCase();
    return (
        error.name === 'QuotaExceededError' ||
        msg.includes('codec reclaimed') ||
        msg.includes('quotaexceedederror') ||
        // Also catch our own timeout errors — likely caused by a reclaimed codec
        msg.includes('backpressure stalled') ||
        msg.includes('decoder closed') ||
        msg.includes('max rebuilds exceeded')
    );
}
