/**
 * @fileoverview WebCodecs-based frame extractor for video export.
 *
 * Replaces per-frame `<video>` element seeking with sequential VideoDecoder
 * decoding for significantly faster export. Uses a custom WebM demuxer
 * ({@link demuxWebm}) to extract encoded chunks from MediaRecorder output,
 * then feeds them through the WebCodecs VideoDecoder for hardware-accelerated
 * sequential decoding.
 *
 * Design constraints:
 * - Feed loop decides when to stop based on **packet timestamps** (not buffer
 *   size), because the decoder's output callback fires asynchronously — the
 *   buffer stays empty during the synchronous feed loop.
 * - Never calls `flush()` between sequential `getFrameAtTime()` calls. Flushing
 *   resets decoder state and requires the next chunk to be a keyframe. A single
 *   flush occurs only after all packets have been consumed.
 * - Returns **cloned** VideoFrames, keeping originals in the buffer for reuse.
 *   This is critical for low-fps sources (e.g. camera at 6 fps) that must serve
 *   multiple export frames (at 30 fps) from the same decoded frame.
 */

import * as Sentry from '@sentry/react';
import { demuxWebm } from './webmDemuxer';
import type { DemuxedVideoPacket } from './webmDemuxer';

/** How far ahead (ms) to feed packets beyond the requested time. */
const FEED_AHEAD_MS = 200;

/** Maximum time (ms) to wait for decoder drain before treating it as stuck. */
const DRAIN_TIMEOUT_MS = 10_000;

/** Maximum number of automatic decoder rebuilds per export. */
const MAX_REBUILDS = 4;


/**
 * Extracts decoded {@link VideoFrame}s from a WebM video source using WebCodecs.
 * Optimised for sequential (monotonically increasing) time access during export.
 */
export class FrameExtractor {
    private url: string;
    private packets: DemuxedVideoPacket[] = [];
    private decoder: VideoDecoder | null = null;
    private decodedFrames: VideoFrame[] = [];
    private nextPacketIndex = 0;
    private codedWidth = 0;
    private codedHeight = 0;
    private description: Uint8Array | undefined;
    private flushed = false;
    private codecString = '';
    private rebuildCount = 0;

    /** Video dimensions — available after {@link initialize}. */
    width = 0;
    height = 0;

    constructor(url: string) {
        this.url = url;
    }

    /**
     * Fetch the video, demux it into encoded packets, and configure the
     * hardware VideoDecoder.
     */
    async initialize(): Promise<void> {
        const response = await fetch(this.url);
        const arrayBuffer = await response.arrayBuffer();
        const { track, packets } = demuxWebm(arrayBuffer);

        this.packets = packets;
        this.codedWidth = track.width;
        this.codedHeight = track.height;
        this.width = track.width;
        this.height = track.height;

        // Map Matroska codec IDs to WebCodecs codec strings
        switch (track.codec) {
            case 'V_VP9':
                this.codecString = 'vp09.00.10.08'; // Profile 0, Level 1.0, 8-bit
                break;
            case 'V_VP8':
                this.codecString = 'vp8';
                break;
            default:
                throw new Error(`[FrameExtractor] Unsupported codec: ${track.codec}`);
        }

        if (track.codecPrivate) {
            this.description = track.codecPrivate;
        }

        this.createDecoder();
    }

    /**
     * Create and configure a fresh VideoDecoder instance.
     * Shared by initialize() and rebuildDecoder().
     */
    private createDecoder(): void {
        this.decoder = new VideoDecoder({
            output: (frame: VideoFrame) => {
                this.decodedFrames.push(frame);
            },
            error: (e: DOMException) => {
                console.error('[FrameExtractor] Decoder error:', e.name, e.message);
                // Don't throw — let getFrameAtTime detect the closed state and trigger recovery
            }
        });

        const config: VideoDecoderConfig = {
            codec: this.codecString,
            codedWidth: this.codedWidth,
            codedHeight: this.codedHeight,
        };
        if (this.description) {
            config.description = this.description;
        }
        this.decoder.configure(config);
    }

    /**
     * Rebuild the decoder after it was reclaimed or errored.
     * Rewinds to the latest keyframe at or before the target time.
     */
    private rebuildDecoder(targetTimeMs: number): void {
        this.rebuildCount++;
        console.warn(`[FrameExtractor] Rebuilding decoder (attempt ${this.rebuildCount}/${MAX_REBUILDS}) at ${targetTimeMs.toFixed(0)}ms`);

        Sentry.addBreadcrumb({
            category: 'codec',
            message: `Decoder rebuild #${this.rebuildCount} at ${targetTimeMs.toFixed(0)}ms`,
            level: 'warning',
            data: { targetTimeMs, nextPacketIndex: this.nextPacketIndex },
        });

        // Close old decoder if still around
        if (this.decoder && this.decoder.state !== 'closed') {
            try { this.decoder.close(); } catch { /* already closed */ }
        }

        // Close any stale frames
        for (const frame of this.decodedFrames) {
            try { frame.close(); } catch { /* already closed */ }
        }
        this.decodedFrames = [];

        // Find the latest keyframe at or before the target time
        let keyframeIndex = 0;
        for (let i = 0; i < this.packets.length; i++) {
            if (this.packets[i].isKeyframe && this.packets[i].timestampMs <= targetTimeMs) {
                keyframeIndex = i;
            }
        }
        this.nextPacketIndex = keyframeIndex;
        this.flushed = false;

        this.createDecoder();
    }

    /**
     * Return the decoded {@link VideoFrame} closest to (but not after) the
     * requested time.
     *
     * The returned frame is a **clone** — the caller owns it and **must** call
     * `.close()` when finished to avoid GPU memory leaks.
     *
     * @param timeSec  Target time in seconds (source-time).
     */
    async getFrameAtTime(timeSec: number): Promise<VideoFrame> {
        const timeMs = timeSec * 1000;

        // Detect reclaimed/errored decoder and attempt recovery
        if (!this.decoder || (this.decoder.state as string) === 'closed') {
            if (this.rebuildCount >= MAX_REBUILDS) {
                throw new Error('[FrameExtractor] Decoder closed — max rebuilds exceeded');
            }
            this.rebuildDecoder(timeMs);
        }

        const targetMicros = timeMs * 1000;

        // 1. Evict stale frames whose successor is also at or before the target.
        while (this.decodedFrames.length > 1 &&
            this.decodedFrames[1].timestamp <= targetMicros) {
            this.decodedFrames.shift()!.close();
        }

        // 2. Feed encoded chunks up to targetTime + margin.
        //    The output callback fires asynchronously, so we use packet
        //    timestamps — not buffer size — to decide when to stop.
        let fed = 0;
        while (this.nextPacketIndex < this.packets.length) {
            // Re-check decoder state — it can close mid-feed from a reclaim
            if ((this.decoder!.state as string) === 'closed') {
                if (this.rebuildCount >= MAX_REBUILDS) {
                    throw new Error('[FrameExtractor] Decoder closed during feed — max rebuilds exceeded');
                }
                this.rebuildDecoder(timeMs);
                fed = 0; // Reset — we'll re-feed from the keyframe
                continue;
            }

            const packet = this.packets[this.nextPacketIndex];
            if (packet.timestampMs > timeMs + FEED_AHEAD_MS && fed > 0) break;

            this.decoder!.decode(new EncodedVideoChunk({
                type: packet.isKeyframe ? 'key' : 'delta',
                timestamp: packet.timestampMs * 1000, // ms → µs
                data: packet.data
            }));
            this.nextPacketIndex++;
            fed++;
        }

        // 3. Wait for all fed chunks to be decoded (deterministic sync).
        if (fed > 0) {
            try {
                await this.awaitDecoderDrain();
            } catch {
                // Drain timed out — decoder is stalled. Attempt rebuild.
                if (this.rebuildCount >= MAX_REBUILDS) {
                    throw new Error('[FrameExtractor] Decoder drain stalled — max rebuilds exceeded');
                }
                this.rebuildDecoder(timeMs);
                // Re-feed from the keyframe after rebuild
                return this.getFrameAtTime(timeSec);
            }
        }

        // 4. One-time flush after all packets have been consumed to drain
        //    any remaining frames from the decoder pipeline.
        if (this.nextPacketIndex >= this.packets.length && !this.flushed) {
            this.flushed = true;
            if ((this.decoder!.state as string) !== 'closed') {
                await this.decoder!.flush();
            }
        }

        // 5. After sync, all fed frames are guaranteed to be in decodedFrames.
        if (this.decodedFrames.length === 0) {
            throw new Error(
                `[FrameExtractor] No decoded frames available at ${timeMs.toFixed(0)} ms`
            );
        }

        // 6. Pick the best frame: latest whose timestamp ≤ target.
        //    Falls back to index 0 when the target is before the first frame.
        let bestIndex = 0;
        for (let i = 1; i < this.decodedFrames.length; i++) {
            if (this.decodedFrames[i].timestamp <= targetMicros) {
                bestIndex = i;
            }
        }

        // Close frames strictly before the chosen one.
        for (let i = 0; i < bestIndex; i++) {
            this.decodedFrames[i].close();
        }
        this.decodedFrames = this.decodedFrames.slice(bestIndex);

        // Return a clone; the original stays in the buffer for reuse by
        // future calls that map to the same source frame.
        return this.decodedFrames[0].clone();
    }

    /**
     * Wait for the decoder to process all queued chunks.
     * Uses the 'dequeue' event which fires each time a chunk finishes decoding,
     * providing deterministic synchronization without timer-based polling.
     *
     * After the queue drains, we also wait for the output callback to fire
     * (it runs asynchronously after the internal dequeue), with a safety timeout.
     *
     * Includes a global timeout to prevent infinite hangs when the decoder
     * is reclaimed or stalled.
     */
    private async awaitDecoderDrain(): Promise<void> {
        if (!this.decoder || (this.decoder.state as string) === 'closed') return;

        const drainStart = performance.now();
        let lastQueueSize = this.decoder.decodeQueueSize;
        let lastChangeTime = drainStart;
        let stallWarned = false;

        // Poll decodeQueueSize instead of relying on the 'dequeue' event,
        // which doesn't fire reliably in all browsers (e.g. Brave).
        while (this.decoder.decodeQueueSize > 0) {
            const now = performance.now();

            // Track queue progress — detect stalls early
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
                        codecString: this.codecString,
                        rebuildCount: this.rebuildCount,
                        userAgent: navigator.userAgent,
                    },
                });
                throw new Error(errorMsg);
            }

            if ((this.decoder.state as string) === 'closed') return;

            await new Promise(r => setTimeout(r, 5));
        }

        // The output callback fires asynchronously after the queue empties —
        // yield briefly so decoded frames appear in the buffer.
        const prevCount = this.decodedFrames.length;
        let waited = 0;
        while (this.decodedFrames.length === prevCount && waited < 500) {
            await new Promise(r => setTimeout(r, 1));
            waited++;
        }
    }

    /** Release all GPU resources and internal state. */
    dispose(): void {
        for (const frame of this.decodedFrames) {
            try { frame.close(); } catch { /* already closed */ }
        }
        this.decodedFrames = [];

        if (this.decoder && (this.decoder.state as string) !== 'closed') {
            try { this.decoder.close(); } catch { /* already closed */ }
        }
        this.decoder = null;
        this.packets = [];
    }
}
