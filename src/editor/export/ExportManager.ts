import * as Mp4Muxer from 'mp4-muxer';
import { ProjectImpl } from '../../core/Project';
import { PlaybackRenderer } from '../components/canvas/PlaybackRenderer';
import { drawBackground } from '../../core/painters/backgroundPainter';
import { drawWatermark } from '../../core/painters/watermarkPainter';
import { getDeviceFrame } from '../../core/deviceFrames';
import type { Project, SourceMetadata } from '../../core/types';
import fullLogoPng from '../../assets/fulllogo.png';

export type ExportQuality = '360p' | '720p' | '1080p' | '4K';

export interface ExportProgress {
    progress: number;
    timeRemainingSeconds: number | null;
}

export class ExportManager {
    private abortController: AbortController | null = null;

    async exportProject(
        project: Project,
        sources: Record<string, SourceMetadata>,
        quality: ExportQuality,
        onProgress: (state: ExportProgress) => void,
        isPro: boolean = false
    ): Promise<void> {
        this.abortController = new AbortController();
        const signal = this.abortController.signal;

        const targetHeight = this.getHeightForQuality(quality);
        const aspectRatio = project.settings.outputSize.width / project.settings.outputSize.height;
        const targetWidth = Math.round(targetHeight * aspectRatio);

        // Ensure even dimensions for encoder compatibility
        const width = targetWidth % 2 === 0 ? targetWidth : targetWidth + 1;
        const height = targetHeight % 2 === 0 ? targetHeight : targetHeight + 1;

        console.log(`[Export] Starting export at ${width}x${height} (${quality})`);

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
            bitrate: this.getBitrate(quality),
            framerate: 30
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

        const videoElements: Record<string, HTMLVideoElement> = {};
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

        const loadVideo = (url: string) => new Promise<HTMLVideoElement>((resolve, reject) => {
            const v = document.createElement('video');
            // Only set crossOrigin for external URLs, not blob: URLs
            if (!url.startsWith('blob:')) {
                v.crossOrigin = 'anonymous';
            }
            v.muted = true;
            v.autoplay = false;
            v.playsInline = true;
            v.onloadedmetadata = () => resolve(v);
            v.onerror = reject;
            v.src = url;
            v.load();
        });

        try {
            const bgSettings = renderProject.settings.background;
            if (bgSettings.type === 'image' && bgSettings.imageUrl) {
                const activeBgSourceId = bgSettings.sourceId;
                const bgUrl = activeBgSourceId && sources[activeBgSourceId]
                    ? sources[activeBgSourceId].url
                    : bgSettings.imageUrl;

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

            const sourceIds = Object.keys(sources);
            for (const id of sourceIds) {
                if (sources[id].type === 'video') {
                    videoElements[id] = await loadVideo(sources[id].url);
                }
            }

            // Load watermark logo for non-pro users
            if (!isPro) {
                imageElements.watermark = await loadImage(fullLogoPng);
            }

            const totalDurationMs = this.getTotalDuration(renderProject);
            const totalDurationSec = totalDurationMs / 1000;
            const sampleRate = 44100;

            const offlineCtx = new OfflineAudioContext(2, Math.ceil(sampleRate * totalDurationSec), sampleRate);

            await Promise.all(Object.values(sources).map(async (source) => {
                if (!source.hasAudio) return;

                try {
                    const response = await fetch(source.url);
                    const arrayBuffer = await response.arrayBuffer();
                    const audioBuffer = await offlineCtx.decodeAudioData(arrayBuffer);

                    renderProject.timeline.outputWindows.forEach((window: any) => {
                        const sourceNode = offlineCtx.createBufferSource();
                        sourceNode.buffer = audioBuffer;
                        sourceNode.connect(offlineCtx.destination);

                        const startTime = window.startMs / 1000;
                        const duration = (window.endMs - window.startMs) / 1000;
                        const offset = (window.startMs) / 1000;

                        if (offset >= 0 && offset < audioBuffer.duration) {
                            sourceNode.start(startTime, offset, duration);
                        }
                    });
                } catch (error) {
                    console.warn(`[Export] Failed to decode audio for source ${source.id}:`, error);
                }
            }));

            const renderedAudioBuffer = await offlineCtx.startRendering();
            this.processAudioBuffer(renderedAudioBuffer, audioEncoder);
            const fps = 30;
            const frameInterval = 1000 / fps;
            const totalFrames = Math.ceil(totalDurationMs / frameInterval);

            const startTime = performance.now();
            let framesProcessed = 0;

            for (let i = 0; i < totalFrames; i++) {
                if (signal.aborted) throw new Error("Export cancelled");

                const currentTimeMs = i * frameInterval;
                const timestampMicros = i * (1000000 / fps);

                // Update Progress
                framesProcessed++;
                const elapsedTime = (performance.now() - startTime) / 1000;
                const fpsRate = framesProcessed / elapsedTime;
                const remainingFrames = totalFrames - framesProcessed;
                const timeRemaining = remainingFrames / fpsRate;

                onProgress({
                    progress: framesProcessed / totalFrames,
                    timeRemainingSeconds: timeRemaining
                });

                const sourceTimeMs = currentTimeMs;
                await Promise.all(Object.values(videoElements).map(async (v) => {
                    v.currentTime = sourceTimeMs / 1000;
                    await new Promise<void>(r => {
                        v.addEventListener('seeked', () => r(), { once: true });
                    });
                }));

                // Render Frame
                // 1. CLEAR & BACKGROUND
                ctx.clearRect(0, 0, width, height);

                // We need to import drawBackground
                // (Import added at top of file separately)
                await drawBackground(
                    ctx,
                    renderProject.settings.background,
                    renderProject.settings.background.backgroundBlur,
                    offscreenCanvas as unknown as HTMLCanvasElement,
                    imageElements.bg
                );

                PlaybackRenderer.render({
                    canvas: offscreenCanvas as unknown as HTMLCanvasElement,
                    ctx,
                    bgRef: imageElements.bg,
                    videoRefs: videoElements,
                    deviceFrameImg: imageElements.device
                }, {
                    project: renderProject,
                    sources: sources,
                    userEvents: {
                        mouseClicks: [], mousePositions: [], keyboardEvents: [], drags: [], scrolls: [], typingEvents: [], urlChanges: []
                    },
                    currentTimeMs: currentTimeMs
                });

                // Draw watermark for non-pro users (last, on top of all layers)
                if (!isPro && imageElements.watermark) {
                    drawWatermark(ctx, imageElements.watermark, width);
                }


                const durationMicros = 1000000 / fps;
                const frame = new VideoFrame(offscreenCanvas, {
                    timestamp: timestampMicros,
                    duration: durationMicros
                });

                videoEncoder.encode(frame, { keyFrame: i % (fps * 2) === 0 });
                frame.close();

                await new Promise(r => setTimeout(r, 0));
            }

            await videoEncoder.flush();
            await audioEncoder.flush();
            muxer.finalize();

            const { buffer } = muxer.target;
            this.downloadBlob(new Blob([buffer], { type: 'video/mp4' }), `${project.name}.mp4`);

        } catch (e) {
            if (signal.aborted) {
                console.log("Export cancelled by user.");
            } else {
                console.error("Export failed:", e);
                throw e;
            }
        } finally {
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
            case '360p': return 360;
            case '720p': return 720;
            case '1080p': return 1080;
            case '4K': return 2160;
        }
    }

    private getCodecString(q: ExportQuality): string {
        switch (q) {
            case '4K': return 'avc1.640033'; // High Profile, Level 5.1
            case '1080p': return 'avc1.64002a'; // High Profile, Level 4.2
            case '720p':
            case '360p':
            default: return 'avc1.42001f'; // Baseline Profile, Level 3.1
        }
    }

    private getBitrate(q: ExportQuality): number {
        // Conservative bitrates (bits per second)
        switch (q) {
            case '360p': return 1_000_000; // 1 Mbps
            case '720p': return 5_000_000; // 5 Mbps
            case '1080p': return 8_000_000; // 8 Mbps
            case '4K': return 25_000_000; // 25 Mbps
        }
    }

    private getTotalDuration(project: Project): number {
        // Last window end time
        const windows = project.timeline.outputWindows;
        if (windows.length === 0) return 0;
        return windows[windows.length - 1].endMs;
    }
}
