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
 *   This is critical for low-fps sources (e.g. webcam at 6 fps) that must serve
 *   multiple export frames (at 30 fps) from the same decoded frame.
 */

import { demuxWebm } from './webmDemuxer';
import type { DemuxedVideoPacket } from './webmDemuxer';

/** How far ahead (ms) to feed packets beyond the requested time. */
const FEED_AHEAD_MS = 200;


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
        let codecString: string;
        switch (track.codec) {
            case 'V_VP9':
                codecString = 'vp09.00.10.08'; // Profile 0, Level 1.0, 8-bit
                break;
            case 'V_VP8':
                codecString = 'vp8';
                break;
            default:
                throw new Error(`[FrameExtractor] Unsupported codec: ${track.codec}`);
        }

        if (track.codecPrivate) {
            this.description = track.codecPrivate;
        }

        this.decoder = new VideoDecoder({
            output: (frame: VideoFrame) => {
                this.decodedFrames.push(frame);
            },
            error: (e: DOMException) => {
                console.error('[FrameExtractor] Decoder error:', e);
            }
        });

        const config: VideoDecoderConfig = {
            codec: codecString,
            codedWidth: this.codedWidth,
            codedHeight: this.codedHeight,
        };
        if (this.description) {
            config.description = this.description;
        }
        this.decoder.configure(config);
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
        if (!this.decoder || this.decoder.state === 'closed') {
            throw new Error('[FrameExtractor] Not initialized or decoder closed');
        }

        const timeMs = timeSec * 1000;
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
            const packet = this.packets[this.nextPacketIndex];
            if (packet.timestampMs > timeMs + FEED_AHEAD_MS && fed > 0) break;

            this.decoder.decode(new EncodedVideoChunk({
                type: packet.isKeyframe ? 'key' : 'delta',
                timestamp: packet.timestampMs * 1000, // ms → µs
                data: packet.data
            }));
            this.nextPacketIndex++;
            fed++;
        }

        // 3. Wait for all fed chunks to be decoded (deterministic sync).
        //    Uses the 'dequeue' event to await the decoder draining its queue,
        //    instead of timer-based polling which is performance-dependent.
        if (fed > 0) {
            await this.awaitDecoderDrain();
        }

        // 4. One-time flush after all packets have been consumed to drain
        //    any remaining frames from the decoder pipeline.
        if (this.nextPacketIndex >= this.packets.length && !this.flushed) {
            this.flushed = true;
            await this.decoder.flush();
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
     */
    private async awaitDecoderDrain(): Promise<void> {
        if (!this.decoder || this.decoder.state === 'closed') return;
        while (this.decoder.decodeQueueSize > 0) {
            await new Promise<void>(resolve => {
                this.decoder!.addEventListener('dequeue', () => resolve(), { once: true });
            });
        }
        // Yield one micro-tick to let the final output callback fire
        await new Promise(r => setTimeout(r, 0));
    }

    /** Release all GPU resources and internal state. */
    dispose(): void {
        for (const frame of this.decodedFrames) {
            try { frame.close(); } catch { /* already closed */ }
        }
        this.decodedFrames = [];

        if (this.decoder && this.decoder.state !== 'closed') {
            try { this.decoder.close(); } catch { /* already closed */ }
        }
        this.decoder = null;
        this.packets = [];
    }
}
