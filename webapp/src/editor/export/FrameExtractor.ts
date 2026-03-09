/**
 * @fileoverview WebCodecs-based frame extractor for video export.
 *
 * Uses the `web-demuxer` library (FFmpeg libavformat via WASM) for reliable
 * demuxing with correct keyframe detection, then feeds EncodedVideoChunks
 * through the WebCodecs VideoDecoder for hardware-accelerated sequential decoding.
 *
 * Architecture: Pre-reads ALL chunks from the WASM worker during initialization,
 * then serves them from an in-memory array during the frame loop. This avoids the
 * ~80ms postMessage round-trip per chunk that made lazy streaming too slow.
 *
 * Design constraints:
 * - Uses `read('video')` which returns EncodedVideoChunk objects with correct
 *   microsecond timestamps. Chunks are cached as {type, timestamp, duration, data}
 *   for efficient replay after decoder rebuild.
 * - Feed loop stops based on chunk timestamps (not buffer size).
 * - Never calls flush() between sequential getFrameAtTime() calls.
 * - Returns cloned VideoFrames; originals stay in buffer for reuse.
 * - Aggressive frame eviction after decode drain to prevent GPU memory leaks.
 */

import * as Sentry from '@sentry/react';
import { WebDemuxer } from 'web-demuxer';

/** How far ahead (ms) to feed packets beyond the requested time. */
const FEED_AHEAD_MS = 200;

/** Maximum time (ms) to wait for decoder drain before treating it as stuck. */
const DRAIN_TIMEOUT_MS = 10_000;

/** Maximum number of automatic decoder rebuilds per export. */
const MAX_REBUILDS = 4;

/** Cached chunk — lightweight copy of EncodedVideoChunk for replay/rebuild. */
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

    // All chunks pre-read at init
    private chunks: CachedChunk[] = [];
    private nextChunkIndex = 0;

    /** Video dimensions — available after {@link initialize}. */
    width = 0;
    height = 0;

    constructor(url: string) {
        this.url = url;
    }

    /**
     * Load the video, pre-read ALL chunks, and configure the decoder.
     * Pre-reading amortizes the WASM worker postMessage overhead into
     * one batch rather than paying ~80ms per chunk during the frame loop.
     */
    async initialize(): Promise<void> {
        const initStart = performance.now();

        this.demuxer = new WebDemuxer({
            wasmFilePath: new URL('/web-demuxer.wasm', window.location.origin).href,
        });

        // Fetch video on main thread — web-demuxer's worker (blob: origin)
        // can't fetch blob: URLs from the main page.
        const response = await fetch(this.url);
        const blob = await response.blob();
        const file = new File([blob], 'source.webm', { type: blob.type || 'video/webm' });
        await this.demuxer.load(file);

        const streamInfo = await this.demuxer.getMediaStream('video');
        this.width = streamInfo.width;
        this.height = streamInfo.height;

        this.decoderConfig = await this.demuxer.getDecoderConfig('video');

        // Pre-read all chunks. read('video') returns EncodedVideoChunks with
        // correct µs timestamps from FFmpeg.
        const readStart = performance.now();
        this.chunks = [];
        const stream = this.demuxer.read('video');
        const reader = stream.getReader();

        while (true) {
            const { done, value } = await reader.read();
            if (done || !value) break;

            const dataCopy = new ArrayBuffer(value.byteLength);
            value.copyTo(dataCopy);

            this.chunks.push({
                type: value.type as 'key' | 'delta',
                timestamp: value.timestamp,
                duration: value.duration ?? 0,
                data: dataCopy,
            });
        }

        if (this.chunks.length === 0) {
            console.error('[FrameExtractor] No video chunks found in source');
            throw new Error('[FrameExtractor] No video chunks found in source');
        }

        const keyframes = this.chunks.filter(c => c.type === 'key').length;
        const first = this.chunks[0];
        const last = this.chunks[this.chunks.length - 1];
        console.log(`[FrameExtractor] Pre-read ${this.chunks.length} chunks (${keyframes} keyframes) in ${(performance.now() - readStart).toFixed(0)}ms, ` +
            `first.ts=${first.timestamp}µs last.ts=${last.timestamp}µs, ` +
            `init total=${(performance.now() - initStart).toFixed(0)}ms, ${this.width}x${this.height}`);

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

    private chunkToEncoded(chunk: CachedChunk): EncodedVideoChunk {
        return new EncodedVideoChunk({
            type: chunk.type,
            timestamp: chunk.timestamp,
            duration: chunk.duration,
            data: chunk.data,
        });
    }

    /**
     * Close all decoded frames whose timestamp is strictly before the target,
     * keeping only the latest frame at or before target for potential reuse.
     * Called both before feeding AND after draining to prevent GPU memory leaks.
     */
    private evictStaleFrames(targetMicros: number): void {
        while (this.decodedFrames.length > 1 &&
            this.decodedFrames[1].timestamp <= targetMicros) {
            this.decodedFrames.shift()!.close();
        }
    }

    private rebuildDecoder(targetTimeMs: number): void {
        this.rebuildCount++;
        console.warn(`[FrameExtractor] Rebuilding decoder (attempt ${this.rebuildCount}/${MAX_REBUILDS}) at ${targetTimeMs.toFixed(0)}ms`);

        Sentry.addBreadcrumb({
            category: 'codec',
            message: `Decoder rebuild #${this.rebuildCount} at ${targetTimeMs.toFixed(0)}ms`,
            level: 'warning',
            data: { targetTimeMs, totalChunks: this.chunks.length },
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
        for (let i = 0; i < this.chunks.length; i++) {
            if (this.chunks[i].type === 'key' && this.chunks[i].timestamp <= targetTimeMicros) {
                keyframeIndex = i;
            }
        }
        this.nextChunkIndex = keyframeIndex;
        this.flushed = false;

        this.createDecoder();
    }

    async getFrameAtTime(timeSec: number): Promise<VideoFrame> {
        const timeMs = timeSec * 1000;

        if (!this.decoder || (this.decoder.state as string) === 'closed') {
            if (this.rebuildCount >= MAX_REBUILDS) {
                throw new Error('[FrameExtractor] Decoder closed — max rebuilds exceeded');
            }
            this.rebuildDecoder(timeMs);
        }

        const targetMicros = timeMs * 1000;

        // 1. Evict stale frames BEFORE feeding new ones
        this.evictStaleFrames(targetMicros);

        // 2. Feed chunks up to target + margin (from pre-read array — instant)
        const feedAheadMicros = (timeMs + FEED_AHEAD_MS) * 1000;
        let fed = 0;

        while (this.nextChunkIndex < this.chunks.length) {
            if ((this.decoder!.state as string) === 'closed') {
                if (this.rebuildCount >= MAX_REBUILDS) {
                    throw new Error('[FrameExtractor] Decoder closed during feed — max rebuilds exceeded');
                }
                this.rebuildDecoder(timeMs);
                fed = 0;
                continue;
            }

            const chunk = this.chunks[this.nextChunkIndex];
            if (chunk.timestamp > feedAheadMicros && fed > 0) break;

            this.decoder!.decode(this.chunkToEncoded(chunk));
            this.nextChunkIndex++;
            fed++;
        }

        // 3. Wait for decoder drain
        if (fed > 0) {
            try {
                await this.awaitDecoderDrain();
            } catch {
                if (this.rebuildCount >= MAX_REBUILDS) {
                    throw new Error('[FrameExtractor] Decoder drain stalled — max rebuilds exceeded');
                }
                this.rebuildDecoder(timeMs);
                return this.getFrameAtTime(timeSec);
            }
        }

        // 4. Evict again AFTER drain — output callbacks during drain may have
        //    added frames from previous decode() calls, causing buffer growth.
        this.evictStaleFrames(targetMicros);

        // 5. One-time flush after all chunks consumed
        if (this.nextChunkIndex >= this.chunks.length && !this.flushed) {
            this.flushed = true;
            if ((this.decoder!.state as string) !== 'closed') {
                await this.decoder!.flush();
            }
        }

        // 6. Pick best frame (latest whose timestamp ≤ target)
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

        // Close everything before the chosen frame
        for (let i = 0; i < bestIndex; i++) {
            this.decodedFrames[i].close();
        }
        this.decodedFrames = this.decodedFrames.slice(bestIndex);

        return this.decodedFrames[0].clone();
    }

    /**
     * Wait for the decoder to process all queued chunks.
     * After the queue empties, yields once for the output callback to fire.
     */
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
                        decoderState: this.decoder.state,
                        rebuildCount: this.rebuildCount,
                        decodedFrameBuffer: this.decodedFrames.length,
                        totalChunks: this.chunks.length,
                        nextChunkIndex: this.nextChunkIndex,
                        sourceWidth: this.width,
                        sourceHeight: this.height,
                        documentVisible: document.visibilityState,
                        userAgent: navigator.userAgent,
                    },
                });
                throw new Error(errorMsg);
            }

            if ((this.decoder.state as string) === 'closed') return;

            await new Promise(r => setTimeout(r, 1));
        }

        // Wait for output callback to deliver decoded frames.
        // A single yield is insufficient on slower machines — poll until
        // at least one new frame appears or a timeout is reached.
        const prevCount = this.decodedFrames.length;
        let postDrainWait = 0;
        while (this.decodedFrames.length === prevCount && postDrainWait < 500) {
            await new Promise(r => setTimeout(r, 1));
            postDrainWait++;
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
        this.chunks = [];

        if (this.demuxer) {
            try { this.demuxer.destroy(); } catch { /* already destroyed */ }
            this.demuxer = null;
        }
    }
}
