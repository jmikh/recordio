import * as Mp4Muxer from 'mp4-muxer';
import * as Sentry from '@sentry/react';
import { ProjectImpl } from '../../core/Project';
import { PlaybackRenderer } from '../components/canvas/PlaybackRenderer';
import { drawBackground } from '../../core/painters/backgroundPainter';
import { drawWatermark } from '../../core/painters/watermarkPainter';
import type { WatermarkPosition } from '../../core/painters/watermarkPainter';
import { getDeviceFrame } from '../../core/deviceFrames';
import { TimeMapper } from '../../core/mappers/timeMapper';
import { FrameExtractor } from './FrameExtractor';
import { resolveVideoCodec, resolveAudioCodec, getHeightForQuality } from './codecResolver';
import { renderAudioBuffer, encodeAudioBuffer } from './audioProcessor';
import type { Project, SourceMetadata } from '../../types';
import watermarkPng from '../../assets/watermark.png';

// Re-export types that consumers depend on
export type { ExportQuality, ExportFps } from './codecResolver';

export interface ExportProgress {
    progress: number;
    timeRemainingSeconds: number | null;
    phase?: 'exporting' | 'uploading';
}

export interface ExportCodecInfo {
    video: { encoder: string; muxer: string; fallback: boolean; tried: string[] };
    audio: { encoder: string; muxer: string; fallback: boolean };
}

export interface ExportResult {
    blob: Blob;
    codecs: ExportCodecInfo;
}

export class ExportManager {
    private abortController: AbortController | null = null;

    async exportProject(
        project: Project,
        quality: import('./codecResolver').ExportQuality,
        fps: import('./codecResolver').ExportFps,
        onProgress: (state: ExportProgress) => void,
        options?: { watermarkPosition?: WatermarkPosition; skipDownload?: boolean }
    ): Promise<ExportResult> {
        this.abortController = new AbortController();
        const signal = this.abortController.signal;

        const targetHeight = getHeightForQuality(quality);
        const aspectRatio = project.settings.outputSize.width / project.settings.outputSize.height;
        const targetWidth = Math.round(targetHeight * aspectRatio);

        // Ensure even dimensions for encoder compatibility
        const width = targetWidth % 2 === 0 ? targetWidth : targetWidth + 1;
        const height = targetHeight % 2 === 0 ? targetHeight : targetHeight + 1;

        const renderProject = ProjectImpl.scale(project, { width, height });

        // Probe codec support: prefer H.264, fall back to VP9; prefer AAC, fall back to Opus
        const videoCodec = await resolveVideoCodec(quality, width, height, fps);
        const audioCodec = await resolveAudioCodec();

        const muxer = new Mp4Muxer.Muxer({
            target: new Mp4Muxer.ArrayBufferTarget(),
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
            fastStart: 'in-memory'
        });

        let videoEncoderError: Error | null = null;
        const videoEncoder = new VideoEncoder({
            output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
            error: (e) => {
                console.error("VideoEncoder error:", e);
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
        const imageElements: { bg: HTMLImageElement | null, device: HTMLImageElement | null, watermark: HTMLImageElement | null } = { bg: null, device: null, watermark: null };

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

            // Initialize frame extractors for screen and camera sources
            for (const source of sources) {
                if (source.runtimeUrl) {
                    const extractor = new FrameExtractor(source.runtimeUrl);
                    await extractor.initialize();
                    frameExtractors[source.id] = extractor;
                }
            }

            // --- Watermark Resolution ---
            // The UI layer decides whether to show the watermark based on pro/unlock status.
            // If watermarkPosition is provided, show watermark; otherwise skip.
            const shouldShowWatermark = !!options?.watermarkPosition;

            if (shouldShowWatermark) {
                imageElements.watermark = await loadImage(watermarkPng);
            }

            const timeMapper = new TimeMapper(renderProject.timeline.outputWindows);
            totalDurationMs = timeMapper.outputDuration;
            const totalDurationSec = totalDurationMs / 1000;

            // --- Audio Rendering ---
            const renderedAudioBuffer = await renderAudioBuffer({
                project: renderProject,
                totalDurationSec,
            });
            encodeAudioBuffer(renderedAudioBuffer, audioEncoder);

            // --- Frame Loop ---
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
                const currentFrameRefs: Record<string, VideoFrame> = {};
                await Promise.all(Object.entries(frameExtractors).map(async ([id, ext]) => {
                    currentFrameRefs[id] = await ext.getFrameAtTime(sourceTimeMs / 1000);
                }));

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
                    currentTimeMs: currentTimeMs,
                    timeMapper: timeMapper
                });

                // Draw watermark for non-pro users (last, on top of all layers; skipped in dev)
                if (shouldShowWatermark && imageElements.watermark) {
                    drawWatermark(ctx, imageElements.watermark, width, height, options?.watermarkPosition);
                }

                const durationMicros = 1000000 / fps;
                const encoderFrame = new VideoFrame(offscreenCanvas, {
                    timestamp: timestampMicros,
                    duration: durationMicros
                });

                if ((videoEncoder.state as string) === 'closed') {
                    encoderFrame.close();
                    Object.values(currentFrameRefs).forEach(f => f.close());
                    throw videoEncoderError
                    ?? new Error(`VideoEncoder closed unexpectedly after ${framesProcessed}/${totalFrames} frames`);
                }
                videoEncoder.encode(encoderFrame, { keyFrame: i % (fps * 2) === 0 });
                encoderFrame.close();

                // Close decoded source frames — they've been drawn to the canvas
                Object.values(currentFrameRefs).forEach(f => f.close());

                // Backpressure: wait for the encoder queue to drain before submitting more.
                // This prevents GPU memory exhaustion at high resolutions (2K/4K).
                while ((videoEncoder.state as string) !== 'closed' && videoEncoder.encodeQueueSize > 5) {
                    await new Promise(r => setTimeout(r, 1));
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

            const { buffer } = muxer.target;
            const blob = new Blob([buffer], { type: 'video/mp4' });

            if (!options?.skipDownload) {
                this.downloadBlob(blob, `${project.name}_${quality}_${fps}fps.mp4`);
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
            this.abortController = null;
        }
    }

    cancel() {
        if (this.abortController) {
            this.abortController.abort();
        }
    }

    private downloadBlob(blob: Blob, filename: string) {
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
