/**
 * @fileoverview WebCodecs-based frame extractor for video export.
 *
 * Uses the `web-demuxer` library (FFmpeg libavformat via WASM) for reliable
 * demuxing with correct keyframe detection, then feeds EncodedVideoChunks
 * through the WebCodecs VideoDecoder for hardware-accelerated sequential decoding.
 *
 * Architecture: Lazy streaming — packets are pulled on-demand from the WASM
 * worker via web-demuxer's `read('video')` ReadableStream, not pre-read into
 * memory. This eliminates the initialization bottleneck.
 */

import * as Sentry from '@sentry/react';
import { WebDemuxer } from 'web-demuxer';

/** How far ahead (ms) to feed packets beyond the requested time. */
const FEED_AHEAD_MS = 200;

/** Maximum time (ms) to wait for decoder drain before treating it as stuck. */
const DRAIN_TIMEOUT_MS = 10_000;

/** Maximum number of automatic decoder rebuilds per export. */
const MAX_REBUILDS = 4;

/** Cached chunk for replay after rebuild. */
interface CachedChunk {
    type: 'key' | 'delta';
    timestamp: number;   // microseconds
    duration: number;    // microseconds
    data: ArrayBuffer;
}

export class FrameExtractor {
    private url: string;
    private demuxer: WebDemuxer | null = null;
    private decoder: VideoDecoder | null = null;
    private decoderConfig: VideoDecoderConfig | null = null;
    private decodedFrames: VideoFrame[] = [];
    private rebuildCount = 0;
    private flushed = false;

    // Lazy streaming
    private streamReader: ReadableStreamDefaultReader<EncodedVideoChunk> | null = null;
    private streamDone = false;
    private consumedChunks: CachedChunk[] = [];
    private nextChunkIndex = 0;

    /** Video dimensions — available after {@link initialize}. */
    width = 0;
    height = 0;

    constructor(url: string) {
        this.url = url;
    }

    /**
     * Load the video, configure the demuxer and decoder.
     * No packets are read — they're pulled lazily during getFrameAtTime().
     */
    async initialize(): Promise<void> {
        const initStart = performance.now();

        this.demuxer = new WebDemuxer({
            wasmFilePath: new URL('/web-demuxer.wasm', window.location.origin).href,
        });

        const fetchStart = performance.now();
        const response = await fetch(this.url);
        const blob = await response.blob();
        const file = new File([blob], 'source.webm', { type: blob.type || 'video/webm' });
        console.log(`[FrameExtractor] Fetch+File: ${(performance.now() - fetchStart).toFixed(0)}ms, size=${(blob.size / 1024 / 1024).toFixed(1)}MB`);

        const loadStart = performance.now();
        await this.demuxer.load(file);
        console.log(`[FrameExtractor] WASM load: ${(performance.now() - loadStart).toFixed(0)}ms`);

        const streamInfo = await this.demuxer.getMediaStream('video');
        this.width = streamInfo.width;
        this.height = streamInfo.height;

        this.decoderConfig = await this.demuxer.getDecoderConfig('video');

        // Start lazy read stream
        const stream = this.demuxer.read('video');
        this.streamReader = stream.getReader();

        console.log(`[FrameExtractor] Init complete: ${(performance.now() - initStart).toFixed(0)}ms, ${this.width}x${this.height}`);

        this.createDecoder();
    }

    private createDecoder(): void {
        if (!this.decoderConfig) {
            throw new Error('[FrameExtractor] Cannot create decoder — no config available');
        }

        this.decoder = new VideoDecoder({
            output: (frame: VideoFrame) => {
                this.decodedFrames.push(frame);
            },
            error: (e: DOMException) => {
                console.error('[FrameExtractor] Decoder error:', e.name, e.message);
            }
        });

        this.decoder.configure(this.decoderConfig);
    }

    /**
     * Pull the next chunk from the stream and cache it.
     */
    private async pullNextChunk(): Promise<CachedChunk | null> {
        if (this.streamDone || !this.streamReader) return null;

        const { done, value } = await this.streamReader.read();
        if (done || !value) {
            this.streamDone = true;
            return null;
        }

        const dataCopy = new ArrayBuffer(value.byteLength);
        value.copyTo(dataCopy);

        const cached: CachedChunk = {
            type: value.type as 'key' | 'delta',
            timestamp: value.timestamp,
            duration: value.duration ?? 0,
            data: dataCopy,
        };
        this.consumedChunks.push(cached);

        // Diagnostic: log first few chunks to verify timestamp units
        if (this.consumedChunks.length <= 3) {
            console.log(`[FrameExtractor] Chunk #${this.consumedChunks.length}: ` +
                `type=${cached.type}, ts=${cached.timestamp}, dur=${cached.duration}, bytes=${cached.data.byteLength}`);
        }

        return cached;
    }

    private cachedToChunk(cached: CachedChunk): EncodedVideoChunk {
        return new EncodedVideoChunk({
            type: cached.type,
            timestamp: cached.timestamp,
            duration: cached.duration,
            data: cached.data,
        });
    }

    private rebuildDecoder(targetTimeMs: number): void {
        this.rebuildCount++;
        console.warn(`[FrameExtractor] Rebuilding decoder (attempt ${this.rebuildCount}/${MAX_REBUILDS}) at ${targetTimeMs.toFixed(0)}ms`);

        Sentry.addBreadcrumb({
            category: 'codec',
            message: `Decoder rebuild #${this.rebuildCount} at ${targetTimeMs.toFixed(0)}ms`,
            level: 'warning',
            data: { targetTimeMs, consumedChunks: this.consumedChunks.length },
        });

        if (this.decoder && this.decoder.state !== 'closed') {
            try { this.decoder.close(); } catch { /* already closed */ }
        }

        for (const frame of this.decodedFrames) {
            try { frame.close(); } catch { /* already closed */ }
        }
        this.decodedFrames = [];

        const targetTimeMicros = targetTimeMs * 1000;
        let keyframeIndex = 0;
        for (let i = 0; i < this.consumedChunks.length; i++) {
            if (this.consumedChunks[i].type === 'key' && this.consumedChunks[i].timestamp <= targetTimeMicros) {
                keyframeIndex = i;
            }
        }
        this.nextChunkIndex = keyframeIndex;
        this.flushed = false;

        this.createDecoder();
    }

    async getFrameAtTime(timeSec: number): Promise<VideoFrame> {
        const callStart = performance.now();
        const timeMs = timeSec * 1000;

        // Detect reclaimed/errored decoder
        if (!this.decoder || (this.decoder.state as string) === 'closed') {
            if (this.rebuildCount >= MAX_REBUILDS) {
                throw new Error('[FrameExtractor] Decoder closed — max rebuilds exceeded');
            }
            this.rebuildDecoder(timeMs);
        }

        const targetMicros = timeMs * 1000;

        // 1. Evict stale frames
        while (this.decodedFrames.length > 1 &&
            this.decodedFrames[1].timestamp <= targetMicros) {
            this.decodedFrames.shift()!.close();
        }

        // 2. Feed chunks
        const feedAheadMicros = (timeMs + FEED_AHEAD_MS) * 1000;
        let fed = 0;
        let pullTimeMs = 0;
        const feedStart = performance.now();

        // Feed from cached chunks (after rebuild)
        while (this.nextChunkIndex < this.consumedChunks.length) {
            if ((this.decoder!.state as string) === 'closed') {
                if (this.rebuildCount >= MAX_REBUILDS) {
                    throw new Error('[FrameExtractor] Decoder closed during feed — max rebuilds exceeded');
                }
                this.rebuildDecoder(timeMs);
                fed = 0;
                continue;
            }

            const cached = this.consumedChunks[this.nextChunkIndex];
            if (cached.timestamp > feedAheadMicros && fed > 0) break;

            this.decoder!.decode(this.cachedToChunk(cached));
            this.nextChunkIndex++;
            fed++;
        }

        // Pull new chunks from stream lazily
        if (this.nextChunkIndex >= this.consumedChunks.length && !this.streamDone) {
            while (true) {
                if ((this.decoder!.state as string) === 'closed') {
                    if (this.rebuildCount >= MAX_REBUILDS) {
                        throw new Error('[FrameExtractor] Decoder closed during feed — max rebuilds exceeded');
                    }
                    this.rebuildDecoder(timeMs);
                    fed = 0;
                    break;
                }

                const pullStart = performance.now();
                const cached = await this.pullNextChunk();
                pullTimeMs += performance.now() - pullStart;
                if (!cached) break;

                if (cached.timestamp > feedAheadMicros && fed > 0) break;

                this.decoder!.decode(this.cachedToChunk(cached));
                this.nextChunkIndex++;
                fed++;
            }
        }

        const feedDurationMs = performance.now() - feedStart;

        // 3. Wait for decoder drain
        let drainDurationMs = 0;
        if (fed > 0) {
            const drainStart = performance.now();
            try {
                await this.awaitDecoderDrain();
            } catch {
                if (this.rebuildCount >= MAX_REBUILDS) {
                    throw new Error('[FrameExtractor] Decoder drain stalled — max rebuilds exceeded');
                }
                this.rebuildDecoder(timeMs);
                return this.getFrameAtTime(timeSec);
            }
            drainDurationMs = performance.now() - drainStart;
        }

        // 4. One-time flush after stream exhausted
        const allConsumed = this.streamDone && this.nextChunkIndex >= this.consumedChunks.length;
        if (allConsumed && !this.flushed) {
            this.flushed = true;
            if ((this.decoder!.state as string) !== 'closed') {
                await this.decoder!.flush();
            }
        }

        // 5. Pick best frame
        if (this.decodedFrames.length === 0) {
            throw new Error(
                `[FrameExtractor] No decoded frames available at ${timeMs.toFixed(0)} ms`
            );
        }

        let bestIndex = 0;
        for (let i = 1; i < this.decodedFrames.length; i++) {
            if (this.decodedFrames[i].timestamp <= targetMicros) {
                bestIndex = i;
            }
        }

        for (let i = 0; i < bestIndex; i++) {
            this.decodedFrames[i].close();
        }
        this.decodedFrames = this.decodedFrames.slice(bestIndex);

        // DIAGNOSTIC: Log slow calls
        const totalMs = performance.now() - callStart;
        if (totalMs > 50 || fed > 5) {
            console.log(`[FrameExtractor] getFrameAtTime(${timeMs.toFixed(0)}ms): ` +
                `${totalMs.toFixed(0)}ms total, fed=${fed}, pull=${pullTimeMs.toFixed(0)}ms, ` +
                `feed=${feedDurationMs.toFixed(0)}ms, drain=${drainDurationMs.toFixed(0)}ms, ` +
                `buffer=${this.decodedFrames.length}, cached=${this.consumedChunks.length}`);
        }

        return this.decodedFrames[0].clone();
    }

    private async awaitDecoderDrain(): Promise<void> {
        if (!this.decoder || (this.decoder.state as string) === 'closed') return;

        const drainStart = performance.now();
        let lastQueueSize = this.decoder.decodeQueueSize;
        let lastChangeTime = drainStart;
        let stallWarned = false;

        while (this.decoder.decodeQueueSize > 0) {
            const now = performance.now();

            if (this.decoder.decodeQueueSize !== lastQueueSize) {
                lastQueueSize = this.decoder.decodeQueueSize;
                lastChangeTime = now;
                stallWarned = false;
            } else if (now - lastChangeTime > 2000 && !stallWarned) {
                stallWarned = true;
                console.warn(`[FrameExtractor] Decoder queue stuck at ${this.decoder.decodeQueueSize} for 2s`);
                Sentry.addBreadcrumb({
                    category: 'codec',
                    message: `Decoder queue stalled (queueSize=${this.decoder.decodeQueueSize}, elapsed=${Math.round(now - drainStart)}ms)`,
                    level: 'warning',
                    data: { queueSize: this.decoder.decodeQueueSize, elapsedMs: Math.round(now - drainStart) },
                });
            }

            if (now - drainStart > DRAIN_TIMEOUT_MS) {
                const errorMsg = `Decoder drain timed out after ${DRAIN_TIMEOUT_MS}ms (queueSize=${this.decoder.decodeQueueSize})`;
                console.error(`[FrameExtractor] ${errorMsg}`);
                Sentry.captureMessage(errorMsg, {
                    level: 'error',
                    tags: { component: 'FrameExtractor' },
                    extra: {
                        queueSize: this.decoder.decodeQueueSize,
                        rebuildCount: this.rebuildCount,
                        userAgent: navigator.userAgent,
                    },
                });
                throw new Error(errorMsg);
            }

            if ((this.decoder.state as string) === 'closed') return;

            await new Promise(r => setTimeout(r, 1));
        }

        // Yield for output callback
        const prevCount = this.decodedFrames.length;
        let waited = 0;
        while (this.decodedFrames.length === prevCount && waited < 200) {
            await new Promise(r => setTimeout(r, 1));
            waited++;
        }
    }

    dispose(): void {
        for (const frame of this.decodedFrames) {
            try { frame.close(); } catch { /* already closed */ }
        }
        this.decodedFrames = [];

        if (this.decoder && (this.decoder.state as string) !== 'closed') {
            try { this.decoder.close(); } catch { /* already closed */ }
        }
        this.decoder = null;
        this.consumedChunks = [];

        if (this.streamReader) {
            try { this.streamReader.cancel(); } catch { /* already cancelled */ }
            this.streamReader = null;
        }

        if (this.demuxer) {
            try { this.demuxer.destroy(); } catch { /* already destroyed */ }
            this.demuxer = null;
        }
    }
}
