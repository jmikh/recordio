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
import type { Project, SourceMetadata, ScreenMetadata } from '../../types';
import watermarkPng from '../../assets/watermark.png';

export type ExportQuality = '480p' | '720p' | '1080p' | '2K' | '4K';
export type ExportFps = 30 | 60;

export interface ExportProgress {
    progress: number;
    timeRemainingSeconds: number | null;
}

export class ExportManager {
    private abortController: AbortController | null = null;

    async exportProject(
        project: Project,
        quality: ExportQuality,
        fps: ExportFps,
        onProgress: (state: ExportProgress) => void,
        options?: { watermarkPosition?: WatermarkPosition }
    ): Promise<void> {
        this.abortController = new AbortController();
        const signal = this.abortController.signal;

        const targetHeight = this.getHeightForQuality(quality);
        const aspectRatio = project.settings.outputSize.width / project.settings.outputSize.height;
        const targetWidth = Math.round(targetHeight * aspectRatio);

        // Ensure even dimensions for encoder compatibility
        const width = targetWidth % 2 === 0 ? targetWidth : targetWidth + 1;
        const height = targetHeight % 2 === 0 ? targetHeight : targetHeight + 1;

        const renderProject = ProjectImpl.scale(project, { width, height });

        const muxer = new Mp4Muxer.Muxer({
            target: new Mp4Muxer.ArrayBufferTarget(),
            video: {
                codec: 'avc',
                width,
                height
            },
            audio: {
                codec: 'aac',
                numberOfChannels: 2,
                sampleRate: 44100
            },
            fastStart: 'in-memory'
        });

        const videoEncoder = new VideoEncoder({
            output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
            error: (e) => console.error("VideoEncoder error:", e)
        });

        videoEncoder.configure({
            codec: this.getCodecString(quality), // Dynamic codec based on resolution
            width,
            height,
            bitrate: this.getBitrate(quality, fps),
            framerate: fps
        });

        const audioEncoder = new AudioEncoder({
            output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
            error: (e) => console.error("AudioEncoder error:", e)
        });

        audioEncoder.configure({
            codec: 'mp4a.40.2',
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
            const sampleRate = 44100;

            const offlineCtx = new OfflineAudioContext(2, Math.ceil(sampleRate * totalDurationSec), sampleRate);

            // --- Audio Source Filtering (Mute Settings) ---
            const audioSettings = renderProject.settings.audio;

            // Build audio sources independently: screen audio + mic audio
            const audioSources: { url: string; volume: number }[] = [];

            // Screen audio (system audio)
            if ((renderProject.screenSource as ScreenMetadata).hasAudio && !audioSettings?.muteScreenAudio) {
                const screenUrl = renderProject.screenSource.runtimeUrl;
                if (screenUrl) {
                    audioSources.push({
                        url: screenUrl,
                        volume: audioSettings?.screenVolume ?? 1,
                    });
                }
            }

            // Microphone audio (separate track)
            if (renderProject.microphoneSource?.runtimeUrl && !audioSettings?.muteMicrophone) {
                audioSources.push({
                    url: renderProject.microphoneSource.runtimeUrl,
                    volume: audioSettings?.microphoneVolume ?? 1,
                });
            }

            await Promise.all(audioSources.map(async (audioSource) => {
                try {
                    const response = await fetch(audioSource.url);
                    const arrayBuffer = await response.arrayBuffer();
                    const audioBuffer = await offlineCtx.decodeAudioData(arrayBuffer);

                    let outputAccSec = 0;
                    renderProject.timeline.outputWindows.forEach((window: any) => {
                        const speed = window.speed || 1.0;
                        const sourceNode = offlineCtx.createBufferSource();
                        sourceNode.buffer = audioBuffer;
                        sourceNode.playbackRate.value = speed;

                        // Apply per-source volume via GainNode
                        const gainNode = offlineCtx.createGain();
                        gainNode.gain.setValueAtTime(audioSource.volume, 0);
                        sourceNode.connect(gainNode);
                        gainNode.connect(offlineCtx.destination);

                        const offset = window.startMs / 1000;
                        const duration = (window.endMs - window.startMs) / 1000;
                        const startTime = outputAccSec;
                        outputAccSec += duration / speed;

                        if (offset >= 0 && offset < audioBuffer.duration) {
                            sourceNode.start(startTime, offset, duration);
                        }
                    });
                } catch (error) {
                    console.warn(`[Export] Failed to decode audio for source:`, error);
                }
            }));

            // --- Background Music Track ---
            if (audioSettings?.music?.enabled) {
                const musicUrl = audioSettings.music.source === 'preset'
                    ? audioSettings.music.presetUrl
                    : audioSettings.music.customRuntimeUrl;

                if (musicUrl) {
                    try {
                        const response = await fetch(musicUrl);
                        const arrayBuffer = await response.arrayBuffer();
                        const musicBuffer = await offlineCtx.decodeAudioData(arrayBuffer);

                        const musicSource = offlineCtx.createBufferSource();
                        musicSource.buffer = musicBuffer;
                        musicSource.loop = true;

                        // Volume control via GainNode
                        const gainNode = offlineCtx.createGain();
                        const musicVolume = audioSettings.music.volume ?? 0.3;
                        gainNode.gain.setValueAtTime(musicVolume, 0);

                        // Fade out at end
                        const fadeMs = audioSettings.music.fadeOutDurationMs ?? 3000;
                        if (fadeMs > 0) {
                            const fadeStartSec = Math.max(0, totalDurationSec - (fadeMs / 1000));
                            gainNode.gain.setValueAtTime(musicVolume, fadeStartSec);
                            gainNode.gain.linearRampToValueAtTime(0, totalDurationSec);
                        }

                        musicSource.connect(gainNode);
                        gainNode.connect(offlineCtx.destination);
                        musicSource.start(0); // Music starts at the beginning of the output
                    } catch (error) {
                        console.warn('[Export] Failed to load background music:', error);
                    }
                }
            }

            const renderedAudioBuffer = await offlineCtx.startRendering();
            this.processAudioBuffer(renderedAudioBuffer, audioEncoder);
            // fps is now passed as a parameter
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

                videoEncoder.encode(encoderFrame, { keyFrame: i % (fps * 2) === 0 });
                encoderFrame.close();

                // Close decoded source frames — they've been drawn to the canvas
                Object.values(currentFrameRefs).forEach(f => f.close());

                // Yield to the event loop only when the encoder is backed up
                // or periodically for UI responsiveness (progress bar, cancel button)
                if (videoEncoder.encodeQueueSize > 10) {
                    await new Promise(r => setTimeout(r, 0));
                } else if (framesProcessed % 30 === 0) {
                    await new Promise(r => setTimeout(r, 0));
                }
            }

            await videoEncoder.flush();
            await audioEncoder.flush();
            muxer.finalize();

            const { buffer } = muxer.target;
            this.downloadBlob(new Blob([buffer], { type: 'video/mp4' }), `${project.name}_${quality}_${fps}fps.mp4`);

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

        } catch (e) {
            if (signal.aborted) {
                // Export cancelled by user — not an error
            } else {
                Sentry.withScope((scope) => {
                    scope.setTag('export.quality', quality);
                    scope.setTag('export.fps', String(fps));
                    scope.setExtra('outputDurationMs', totalDurationMs);
                    scope.setExtra('framesProcessed', framesProcessed);
                    scope.setExtra('totalFrames', totalFrames);
                    Sentry.captureException(e instanceof Error ? e : new Error(String(e)));
                });
                throw e;
            }
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

    private processAudioBuffer(audioBuffer: AudioBuffer, encoder: AudioEncoder) {
        const totalFrames = audioBuffer.length;
        const channels = audioBuffer.numberOfChannels;
        const sampleRate = audioBuffer.sampleRate;
        const chunkSize = 44100;

        for (let frameOffset = 0; frameOffset < totalFrames; frameOffset += chunkSize) {
            const size = Math.min(chunkSize, totalFrames - frameOffset);
            const destBuffer = new Float32Array(size * channels);

            for (let c = 0; c < channels; c++) {
                const channelData = audioBuffer.getChannelData(c);
                const segment = channelData.subarray(frameOffset, frameOffset + size);
                destBuffer.set(segment, c * size);
            }

            const timestampMicros = (frameOffset / sampleRate) * 1000000;

            const audioData = new AudioData({
                format: 'f32-planar',
                sampleRate,
                numberOfFrames: size,
                numberOfChannels: channels,
                timestamp: timestampMicros,
                data: destBuffer
            });

            encoder.encode(audioData);
            audioData.close();
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

    private getHeightForQuality(q: ExportQuality): number {
        switch (q) {
            case '480p': return 480;
            case '720p': return 720;
            case '1080p': return 1080;
            case '2K': return 1440;
            case '4K': return 2160;
        }
    }

    private getCodecString(q: ExportQuality): string {
        switch (q) {
            case '4K': return 'avc1.640033'; // High Profile, Level 5.1
            case '2K': return 'avc1.640028'; // High Profile, Level 4.0
            case '1080p': return 'avc1.64002a'; // High Profile, Level 4.2
            case '720p':
            case '480p':
            default: return 'avc1.42001f'; // Baseline Profile, Level 3.1
        }
    }

    private getBitrate(q: ExportQuality, fps: ExportFps): number {
        // Base bitrates at 30fps (bits per second)
        let base: number;
        switch (q) {
            case '480p': base = 2_000_000; break; // 2 Mbps
            case '720p': base = 5_000_000; break; // 5 Mbps
            case '1080p': base = 8_000_000; break; // 8 Mbps
            case '2K': base = 15_000_000; break; // 15 Mbps
            case '4K': base = 25_000_000; break; // 25 Mbps
        }
        // Scale up 1.5x for 60fps to maintain per-frame quality
        return fps === 60 ? Math.round(base * 1.5) : base;
    }

    private getTotalDuration(project: Project): number {
        const timeMapper = new TimeMapper(project.timeline.outputWindows);
        return timeMapper.outputDuration;
    }
}
