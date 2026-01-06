import * as Mp4Muxer from 'mp4-muxer';
import { ProjectImpl } from '../../core/Project';
import { PlaybackRenderer } from '../components/canvas/PlaybackRenderer';
import { drawBackground } from '../../core/painters/backgroundPainter';
import { getDeviceFrame } from '../../core/deviceFrames';
import type { Project, SourceMetadata } from '../../core/types';

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
        onProgress: (state: ExportProgress) => void
    ): Promise<void> { // Returns void, triggers download internally
        this.abortController = new AbortController();
        const signal = this.abortController.signal;

        // 1. Calculate Dimensions
        const targetHeight = this.getHeightForQuality(quality);
        const aspectRatio = project.settings.outputSize.width / project.settings.outputSize.height;
        const targetWidth = Math.round(targetHeight * aspectRatio);

        // Ensure even dimensions (required by some encoders)
        const width = targetWidth % 2 === 0 ? targetWidth : targetWidth + 1;
        const height = targetHeight % 2 === 0 ? targetHeight : targetHeight + 1;

        console.log(`[Export] Starting export at ${width}x${height} (${quality})`);

        // 2. Prepare Render Project (Clone with resize)
        const renderProject = ProjectImpl.scale(project, { width, height });

        // 3. Prepare Muxer & Encoders
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

        // 4. Prepare Canvas
        const offscreenCanvas = new OffscreenCanvas(width, height);
        // We need a context compatible with our Painter. 
        // Our existing context usage is standard 2D.
        const ctx = offscreenCanvas.getContext('2d') as unknown as CanvasRenderingContext2D;
        // Note: Types might mismatch between OffscreenCanvasRenderingContext2D and CanvasRenderingContext2D 
        // but for basic drawing they are compatible.

        // 5. Prepare Resources (Videos & Images)
        const videoElements: Record<string, HTMLVideoElement> = {};
        const imageElements: { bg: HTMLImageElement | null, device: HTMLImageElement | null } = { bg: null, device: null };

        // Helper to load image
        const loadImage = (url: string) => new Promise<HTMLImageElement>((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = url;
        });

        // Helper to load video
        const loadVideo = (url: string) => new Promise<HTMLVideoElement>((resolve, reject) => {
            const v = document.createElement('video');
            v.crossOrigin = 'anonymous';
            v.muted = true; // Important for programmatic seeking
            v.autoplay = false;
            v.playsInline = true;
            v.onloadedmetadata = () => resolve(v);
            v.onerror = reject;
            v.src = url;
            v.load(); // Trigger load
        });

        try {
            // Load Background
            const bgSettings = renderProject.settings.background;
            if (bgSettings.type === 'image' && bgSettings.imageUrl) {
                // Resolve URL if it's a source ID? 
                // The painter expects loaded images.
                // Check if background is sourceId in settings?
                // logic from CanvasContainer:
                const activeBgSourceId = bgSettings.sourceId;
                const bgUrl = activeBgSourceId && sources[activeBgSourceId]
                    ? sources[activeBgSourceId].url
                    : bgSettings.imageUrl;

                if (bgUrl) {
                    imageElements.bg = await loadImage(bgUrl);
                }
            }

            // Load Device Frame
            // Load Device Frame
            const deviceFrameSettings = renderProject.settings.screen;
            if (deviceFrameSettings.mode === 'device' && deviceFrameSettings.deviceFrameId) {
                const frameDef = getDeviceFrame(deviceFrameSettings.deviceFrameId);
                if (frameDef) {
                    imageElements.device = await loadImage(frameDef.imageUrl);
                }
            }

            // Load Videos
            // We need to preload all Used video sources.
            const sourceIds = Object.keys(sources);
            for (const id of sourceIds) {
                if (sources[id].type === 'video' || sources[id].type === 'audio') {
                    // Audio elements (for audio track) are handled by WebAudio.
                    // Video elements (for video track) need to be sought.
                    if (sources[id].type === 'video') {
                        videoElements[id] = await loadVideo(sources[id].url);
                    }
                }
            }

            // 6. Audio Rendering (OfflineAudioContext)
            // We render *all* audio ahead of time or in chunks?
            // WebCodecs AudioEncoder takes AudioData.
            // Simplest: Render entire timeline to an AudioBuffer, then slice it into chunks?
            // Max duration? if project is 10 mins, might be large.
            // Let's try rendering 1 minute chunks or just one buffer if < 5 mins.

            const totalDurationMs = this.getTotalDuration(renderProject);
            const totalDurationSec = totalDurationMs / 1000;
            const sampleRate = 44100;

            // Limit: OfflineAudioContext has limits. Chrome ~24h? Length is buffer size.
            // 44100 * 60 * 10 = 26M samples. Safe.

            const offlineCtx = new OfflineAudioContext(2, Math.ceil(sampleRate * totalDurationSec), sampleRate);

            // Schedule Sources
            await Promise.all(Object.values(sources).map(async (source) => {
                if (!source.hasAudio) return;
                // Fetch ArrayBuffer
                const response = await fetch(source.url);
                const arrayBuffer = await response.arrayBuffer();
                const audioBuffer = await offlineCtx.decodeAudioData(arrayBuffer);

                // We need to schedule this source according to the timeline.
                // We need to know *when* this source plays.
                // Project structure: screenSourceId is main track.
                // Does 'sources' map give us timeline usage?
                // The Project.recording stores the segments? 
                // Ah, the current project structure is simple:
                // Single Screen Source + Single Camera Source overlaid?
                // Or is it a full timeline?
                // Looking at Project types... `recording.screenSourceId`.
                // It seems it's one continuous playing of the source from 0 to end?
                // Wait, `timeline.outputWindows` defines which PARTS of source play.
                // Gaps are silence.

                // We need to iterate output windows and schedule the source buffer nodes.

                renderProject.timeline.outputWindows.forEach((window: any) => {
                    // window.startMs -> Output time.
                    // We need to map Window to Source Time?
                    // Wait, `outputWindows` map Timeline Time (0..N) to Source Time?
                    // No, OutputWindow { startMs, endMs }. 
                    // And we have `timelineOffsetMs`.
                    // SourceTime = OutputTime - timelineOffsetMs.

                    // So for the Screen Source:
                    // Source Start = window.startMs - offset.
                    // Duration = window.endMs - window.startMs.

                    // We create a buffer source.
                    const sourceNode = offlineCtx.createBufferSource();
                    sourceNode.buffer = audioBuffer;
                    sourceNode.connect(offlineCtx.destination);

                    const startTime = window.startMs / 1000;
                    const duration = (window.endMs - window.startMs) / 1000;
                    const offset = (window.startMs - renderProject.timeline.recording.timelineOffsetMs) / 1000;

                    if (offset >= 0 && offset < audioBuffer.duration) {
                        sourceNode.start(startTime, offset, duration);
                    }
                });
            }));

            // Render Audio
            const renderedAudioBuffer = await offlineCtx.startRendering();

            // Feed Audio to Encoder
            this.processAudioBuffer(renderedAudioBuffer, audioEncoder);


            // 7. Video Rendering Loop
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

                // Seek Videos (Wait for seek completion)
                // We need to map Output Time -> Source Time
                const sourceTimeMs = currentTimeMs - renderProject.timeline.recording.timelineOffsetMs;
                await Promise.all(Object.values(videoElements).map(async (v) => {
                    v.currentTime = sourceTimeMs / 1000;
                    // Wait for 'seeked' event? 
                    // Usually needed for precise frame capture.
                    await new Promise<void>(r => {
                        const handl = () => {
                            v.removeEventListener('seeked', handl);
                            r();
                        };
                        // If already there?
                        // v.currentTime setter is async in behavior for decoding.
                        v.addEventListener('seeked', handl, { once: true });
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

                // PlaybackRenderer needs `videoRefs` map.
                // And `state`.

                // We rely on `PlaybackRenderer.render` to update the context.
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
                        // TODO: Pass actual user events!
                    },
                    currentTimeMs: currentTimeMs
                });


                // Create VideoFrame
                // We can create from OffscreenCanvas
                const durationMicros = 1000000 / fps;
                const frame = new VideoFrame(offscreenCanvas, {
                    timestamp: timestampMicros,
                    duration: durationMicros
                });

                videoEncoder.encode(frame, { keyFrame: i % (fps * 2) === 0 });
                frame.close();

                // Yield to Event Loop
                await new Promise(r => setTimeout(r, 0));
            }

            // Finish
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
            // Cleanup
            this.abortController = null;
        }
    }

    cancel() {
        if (this.abortController) {
            this.abortController.abort();
        }
    }

    private processAudioBuffer(audioBuffer: AudioBuffer, encoder: AudioEncoder) {
        // We need to feed planar data to AudioData
        // WebCodecs expects interleaved? or planar?
        // AudioData init: { format, sampleRate, numberOfFrames, numberOfChannels, timestamp, data }

        // We split into chunks of e.g. 1 second (44100 frames)
        const totalFrames = audioBuffer.length;
        const channels = audioBuffer.numberOfChannels;
        const sampleRate = audioBuffer.sampleRate;
        const chunkSize = 44100;

        for (let frameOffset = 0; frameOffset < totalFrames; frameOffset += chunkSize) {
            const size = Math.min(chunkSize, totalFrames - frameOffset);

            // Create planar data buffer
            // Float32 format
            const destBuffer = new Float32Array(size * channels);
            // Copy channel data
            // AudioData expects Interleaved or Planar?
            // "s16", "s32", "f32", "u8", "s16-planar", "s32-planar", "f32-planar"
            // Let's use "f32-planar".
            // Layout: C1 C1 C1 ... C2 C2 C2 ...

            for (let c = 0; c < channels; c++) {
                const channelData = audioBuffer.getChannelData(c);
                // Copy segment
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
