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

import { WebDemuxer } from 'web-demuxer';

/** How far ahead (ms) to feed packets beyond the requested time. */
const FEED_AHEAD_MS = 2000;

/** Maximum number of automatic decoder rebuilds per export. */
const MAX_REBUILDS = 25;

/** Timeout (ms) for the hardware decode probe during initialization. */
const HW_PROBE_TIMEOUT_MS = 2_000;

/**
 * Injectable decode preference storage.
 * In webapp: backed by localStorage. In headless render: no-op.
 */
export interface DecodePreferences {
    getPreferSoftwareDecode(): boolean;
    setPreferSoftwareDecode(value: boolean): void;
}

/** Default no-op implementation — always uses hardware decode. */
const defaultDecodePreferences: DecodePreferences = {
    getPreferSoftwareDecode: () => false,
    setPreferSoftwareDecode: () => {},
};

/** Cached chunk — lightweight copy of EncodedVideoChunk for replay/rebuild. */
interface CachedChunk {
    type: 'key' | 'delta';
    timestamp: number;   // microseconds
    duration: number;    // microseconds
    /** Raw encoded data. Nulled after the chunk is safely past the rebuild watermark to free memory. */
    data: ArrayBuffer | null;
}

export class FrameExtractor {
    private url: string;
    private demuxer: WebDemuxer | null = null;
    private decoder: VideoDecoder | null = null;
    private decoderConfig: VideoDecoderConfig | null = null;
    private decodedFrames: VideoFrame[] = [];
    private rebuildCount = 0;
    private flushed = false;
    private forceSoftware = false;
    private safariFlushMode = false;
    private decodePrefs: DecodePreferences;

    // All chunks pre-read at init
    private chunks: CachedChunk[] = [];
    private nextChunkIndex = 0;

    /** Number of chunks fed to the decoder in the last `getFrameAtTime` call. */
    public lastChunksFed = 0;

    /** Video dimensions — available after {@link initialize}. */
    width = 0;
    height = 0;

    constructor(url: string, decodePreferences?: DecodePreferences) {
        this.url = url;
        this.decodePrefs = decodePreferences ?? defaultDecodePreferences;
    }

    /** Whether this extractor is using software (CPU) decode. */
    get isSoftwareDecode(): boolean {
        return this.forceSoftware;
    }

    /**
     * Load the video, pre-read ALL chunks, and configure the decoder.
     * Pre-reading amortizes the WASM worker postMessage overhead into
     * one batch rather than paying ~80ms per chunk during the frame loop.
     *
     * @param onProgress Optional callback reporting pre-read progress (0–1).
     */
    async initialize(onProgress?: (progress: number) => void): Promise<void> {
        const initStart = performance.now();

        this.demuxer = new WebDemuxer({
            wasmFilePath: new URL('/web-demuxer.wasm', window.location.origin).href,
        });

        // Fetch video on main thread — web-demuxer's worker (blob: origin)
        // can't fetch blob: URLs from the main page.
        console.log(`[FrameExtractor] Fetching video URL: "${this.url}" (type=${this.url?.startsWith('blob:') ? 'blob' : 'network'})`);
        let response: Response;
        try {
            response = await fetch(this.url);
        } catch (e) {
            console.error(`[FrameExtractor] Failed to fetch video URL: "${this.url}"`, e);
            throw e;
        }
        if (!response.ok) {
            console.error(`[FrameExtractor] Video fetch returned ${response.status} ${response.statusText} for URL: "${this.url}"`);
        }
        const blob = await response.blob();

        // Detect container format from MIME type — web-demuxer uses the file
        // extension for format detection (FFmpeg libavformat), so .webm vs .mp4 matters.
        const mimeType = blob.type || 'video/webm';
        const isMP4 = mimeType.includes('mp4') || mimeType.includes('quicktime');
        const fileName = isMP4 ? 'source.mp4' : 'source.webm';
        console.log(`[FrameExtractor] Blob: ${(blob.size / 1024 / 1024).toFixed(1)}MB, type="${blob.type}", using fileName="${fileName}"`);
        const file = new File([blob], fileName, { type: mimeType });
        await this.demuxer.load(file);

        const streamInfo = await this.demuxer.getMediaStream('video');
        this.width = streamInfo.width;
        this.height = streamInfo.height;
        const videoDurationUs = (streamInfo.duration ?? 0) * 1_000_000; // seconds → µs

        this.decoderConfig = await this.demuxer.getDecoderConfig('video');
        console.log(`[FrameExtractor] Decoder config:`, JSON.stringify({
            codec: this.decoderConfig?.codec,
            codedWidth: this.decoderConfig?.codedWidth,
            codedHeight: this.decoderConfig?.codedHeight,
            hardwareAcceleration: this.decoderConfig?.hardwareAcceleration,
            hasDescription: !!this.decoderConfig?.description,
            descriptionLength: this.decoderConfig?.description ? (this.decoderConfig.description as ArrayBuffer).byteLength : 0,
        }));

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

            // Report pre-read progress every 50 chunks
            if (onProgress && videoDurationUs > 0 && this.chunks.length % 50 === 0) {
                onProgress(Math.min(0.99, value.timestamp / videoDurationUs));
            }
        }

        if (this.chunks.length === 0) {
            console.error('[FrameExtractor] No video chunks found in source');
            throw new Error('[FrameExtractor] No video chunks found in source');
        }

        const keyframes = this.chunks.filter(c => c.type === 'key').length;
        const totalChunkBytes = this.chunks.reduce((sum, c) => sum + (c.data?.byteLength ?? 0), 0);
        const first = this.chunks[0];
        const last = this.chunks[this.chunks.length - 1];
        const mem = (performance as any).memory;
        const memStr = mem ? `, heap=${(mem.usedJSHeapSize / 1024 / 1024).toFixed(0)}/${(mem.jsHeapSizeLimit / 1024 / 1024).toFixed(0)}MB` : '';
        console.log(`[FrameExtractor] Pre-read ${this.chunks.length} chunks (${keyframes} keyframes, ${(totalChunkBytes / 1024 / 1024).toFixed(1)}MB) in ${(performance.now() - readStart).toFixed(0)}ms, ` +
            `first.ts=${first.timestamp}µs last.ts=${last.timestamp}µs, ` +
            `init total=${(performance.now() - initStart).toFixed(0)}ms, ${this.width}x${this.height}${memStr}`);

        // Check if software decode was previously required
        if (this.decodePrefs.getPreferSoftwareDecode()) {
            console.log('[FrameExtractor] Using software decode (persisted from previous failure)');
            this.forceSoftware = true;
        } else {
            // Probe hardware decoder — decode a single keyframe with 2s timeout
            await this.probeHardwareDecode();
        }

        await this.createDecoder();
        console.log(`[FrameExtractor] Decoder ready (${this.forceSoftware ? 'software' : 'hardware'})`);
    }

    /**
     * Quick probe: create a hardware decoder, feed one keyframe, and check
     * if the output callback fires within HW_PROBE_TIMEOUT_MS.
     * If it doesn't, flip to software decode and persist.
     */
    private async probeHardwareDecode(): Promise<void> {
        if (!this.decoderConfig || this.chunks.length === 0) return;

        const firstKeyframe = this.chunks.find(c => c.type === 'key');
        if (!firstKeyframe) return;

        let gotFrame = false;
        const probe = new VideoDecoder({
            output: (frame: VideoFrame) => {
                gotFrame = true;
                frame.close();
            },
            error: () => { /* probe errors handled by timeout */ },
        });

        try {
            probe.configure(this.decoderConfig);
            probe.decode(this.chunkToEncoded(firstKeyframe));

            const start = performance.now();
            while (!gotFrame && performance.now() - start < HW_PROBE_TIMEOUT_MS) {
                await new Promise(r => setTimeout(r, 10));
            }

            if (!gotFrame) {
                console.warn('[FrameExtractor] Hardware decode probe failed — switching to software decode');
                this.forceSoftware = true;
                this.decodePrefs.setPreferSoftwareDecode(true);
            } else {
                console.log(`[FrameExtractor] Hardware decode probe OK (${(performance.now() - start).toFixed(0)}ms)`);
            }
        } catch (e) {
            console.warn('[FrameExtractor] Hardware decode probe threw — switching to software decode', e);
            this.forceSoftware = true;
            this.decodePrefs.setPreferSoftwareDecode(true);
        } finally {
            try { if (probe.state !== 'closed') probe.close(); } catch { /* OK */ }
        }
    }

    private async createDecoder(): Promise<void> {
        if (!this.decoderConfig) {
            throw new Error('[FrameExtractor] Cannot create decoder — no config available');
        }

        const config = { ...this.decoderConfig };
        if (this.forceSoftware) {
            config.hardwareAcceleration = 'prefer-software';
        }

        try {
            const support = await VideoDecoder.isConfigSupported(config);
            console.log(`[FrameExtractor] isConfigSupported:`, JSON.stringify({
                supported: support.supported,
                codec: config.codec,
                codedWidth: config.codedWidth,
                codedHeight: config.codedHeight,
                hardwareAcceleration: config.hardwareAcceleration,
            }));
            if (!support.supported) {
                console.error('[FrameExtractor] Decoder config NOT supported! Trying without description...');
                delete config.description;
                const support2 = await VideoDecoder.isConfigSupported(config);
                console.log(`[FrameExtractor] isConfigSupported (no description):`, support2.supported);
            }
        } catch (e) {
            console.error('[FrameExtractor] isConfigSupported threw:', e);
        }

        this.decoder = new VideoDecoder({
            output: (frame: VideoFrame) => {
                this.decodedFrames.push(frame);
            },
            error: (e: DOMException) => {
                console.error('[FrameExtractor] Decoder error:', e.name, e.message, e);
                console.error('[FrameExtractor] Decoder state at error:', this.decoder?.state, 'decodedFrames:', this.decodedFrames.length, 'nextChunkIndex:', this.nextChunkIndex);
            }
        });

        this.decoder.configure(config);
    }

    private chunkToEncoded(chunk: CachedChunk): EncodedVideoChunk {
        if (!chunk.data) {
            throw new Error(`[FrameExtractor] Chunk at ${chunk.timestamp}µs has been released — cannot decode`);
        }
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
     */
    private evictStaleFrames(targetMicros: number): void {
        while (this.decodedFrames.length > 1 &&
            this.decodedFrames[1].timestamp <= targetMicros) {
            this.decodedFrames.shift()!.close();
        }
    }

    /**
     * Release ArrayBuffer data for chunks safely behind the rebuild watermark.
     */
    private releaseConsumedChunks(): void {
        let lastKf = -1;
        let prevKf = -1;
        for (let i = 0; i < this.nextChunkIndex && i < this.chunks.length; i++) {
            if (this.chunks[i].type === 'key' && this.chunks[i].data !== null) {
                prevKf = lastKf;
                lastKf = i;
            }
        }
        if (prevKf > 0) {
            for (let i = 0; i < prevKf; i++) {
                this.chunks[i].data = null;
            }
        }
    }

    private async rebuildDecoder(targetTimeMs: number): Promise<void> {
        this.rebuildCount++;

        // On first rebuild, switch to software decode — hardware is unreliable
        if (!this.forceSoftware) {
            this.forceSoftware = true;
            this.decodePrefs.setPreferSoftwareDecode(true);
            console.warn(`[FrameExtractor] Switching to software decode after hardware failure`);
        }

        console.warn(`[FrameExtractor] Rebuilding decoder (attempt ${this.rebuildCount}/${MAX_REBUILDS}) at ${targetTimeMs.toFixed(0)}ms [software=${this.forceSoftware}]`);

        if (this.decoder && this.decoder.state !== 'closed') {
            try { this.decoder.close(); } catch { /* already closed */ }
        }

        for (const frame of this.decodedFrames) {
            try { frame.close(); } catch { /* already closed */ }
        }
        this.decodedFrames = [];

        const targetTimeMicros = targetTimeMs * 1000;
        let keyframeIndex = -1;
        for (let i = 0; i < this.chunks.length; i++) {
            if (this.chunks[i].type === 'key' && this.chunks[i].data !== null && this.chunks[i].timestamp <= targetTimeMicros) {
                keyframeIndex = i;
            }
        }

        // No keyframe with data before target — use earliest available
        if (keyframeIndex === -1) {
            for (let i = 0; i < this.chunks.length; i++) {
                if (this.chunks[i].type === 'key' && this.chunks[i].data !== null) {
                    keyframeIndex = i;
                    break;
                }
            }
        }

        if (keyframeIndex === -1) {
            throw new Error(`[FrameExtractor] Rebuild failed — all chunk data has been released`);
        }

        this.nextChunkIndex = keyframeIndex;
        this.flushed = false;

        await this.createDecoder();
    }

    async getFrameAtTime(timeSec: number): Promise<VideoFrame> {
        const timeMs = timeSec * 1000;

        if (!this.decoder || (this.decoder.state as string) === 'closed') {
            console.warn(`[FrameExtractor] getFrameAtTime(${timeMs}ms): decoder is ${this.decoder?.state ?? 'null'}, rebuilding...`);
            if (this.rebuildCount >= MAX_REBUILDS) {
                throw new Error('[FrameExtractor] Decoder closed — max rebuilds exceeded');
            }
            await this.rebuildDecoder(timeMs);
        }

        const targetMicros = timeMs * 1000;

        // 1. Evict stale frames BEFORE feeding new ones
        this.evictStaleFrames(targetMicros);

        // In Safari flush mode, check if the buffer already has frames covering the target.
        const bufferCoversTarget = this.safariFlushMode && this.decodedFrames.length > 0 &&
            this.decodedFrames.some(f => f.timestamp <= targetMicros);

        let fed = 0;

        if (!bufferCoversTarget) {
            // 2. Feed chunks up to target + margin
            const feedAheadMicros = (timeMs + FEED_AHEAD_MS) * 1000;

            // In Safari flush mode, if we need new frames, the decoder was reset by
            // the previous flush. We must start from a keyframe.
            if (this.safariFlushMode && this.nextChunkIndex < this.chunks.length &&
                this.chunks[this.nextChunkIndex].type !== 'key') {
                let keyframeIdx = 0;
                for (let i = 0; i < this.chunks.length; i++) {
                    if (this.chunks[i].type === 'key' && this.chunks[i].timestamp <= targetMicros) {
                        keyframeIdx = i;
                    }
                }
                this.nextChunkIndex = keyframeIdx;
            }

            while (this.nextChunkIndex < this.chunks.length) {
                if ((this.decoder!.state as string) === 'closed') {
                    console.warn(`[FrameExtractor] Decoder closed during feed at chunk ${this.nextChunkIndex}`);
                    if (this.rebuildCount >= MAX_REBUILDS) {
                        throw new Error('[FrameExtractor] Decoder closed during feed — max rebuilds exceeded');
                    }
                    await this.rebuildDecoder(timeMs);
                    fed = 0;
                    continue;
                }

                const chunk = this.chunks[this.nextChunkIndex];
                if (chunk.timestamp > feedAheadMicros && fed > 0) break;

                this.decoder!.decode(this.chunkToEncoded(chunk));
                this.nextChunkIndex++;
                fed++;
            }

            // 3. Wait only until a frame covering the target time is available
            //    (non-blocking — the decoder continues processing remaining chunks async)
            if (fed > 0) {
                try {
                    await this.awaitFrameCovering(targetMicros);
                } catch {
                    if (this.rebuildCount >= MAX_REBUILDS) {
                        throw new Error('[FrameExtractor] Decoder stalled — max rebuilds exceeded');
                    }
                    await this.rebuildDecoder(timeMs);
                    return this.getFrameAtTime(timeSec);
                }
            }

            // 3b. Safari/WKWebView: frames only appear after flush().
            if ((this.decodedFrames.length === 0 && fed > 0) || this.safariFlushMode) {
                if (fed > 0 && this.decoder && (this.decoder.state as string) !== 'closed') {
                    console.log(`[FrameExtractor] No frames after drain — flushing decoder (safariFlushMode=${this.safariFlushMode})...`);
                    const flushStart = performance.now();
                    await Promise.race([
                        this.decoder.flush(),
                        new Promise<void>((_, reject) => setTimeout(() => reject(new Error('flush timeout')), 10_000)),
                    ]);
                    console.log(`[FrameExtractor] Flush done in ${(performance.now() - flushStart).toFixed(0)}ms, decodedFrames=${this.decodedFrames.length}`);
                    if (!this.safariFlushMode) {
                        console.log(`[FrameExtractor] Safari flush mode activated`);
                        this.safariFlushMode = true;
                    }
                }
            }
        }

        // 4. Evict again AFTER drain
        this.evictStaleFrames(targetMicros);

        // 5. One-time flush after all chunks consumed
        if (this.nextChunkIndex >= this.chunks.length && !this.flushed) {
            this.flushed = true;
            if ((this.decoder!.state as string) !== 'closed') {
                console.log(`[FrameExtractor] Final flush (all chunks consumed)...`);
                await Promise.race([
                    this.decoder!.flush(),
                    new Promise<void>((_, reject) => setTimeout(() => reject(new Error('final flush timeout')), 10_000)),
                ]);
                console.log(`[FrameExtractor] Final flush done, decodedFrames=${this.decodedFrames.length}`);
            }
        }

        // 6. Pick best frame (latest whose timestamp ≤ target)
        if (this.decodedFrames.length === 0) {
            console.error(`[FrameExtractor] FAILURE: No decoded frames at ${timeMs}ms. Debug state:`, {
                totalChunks: this.chunks.length,
                nextChunkIndex: this.nextChunkIndex,
                fed,
                decoderState: this.decoder?.state,
                decodeQueueSize: this.decoder?.decodeQueueSize,
                rebuildCount: this.rebuildCount,
                forceSoftware: this.forceSoftware,
                firstChunkTs: this.chunks[0]?.timestamp,
                firstChunkType: this.chunks[0]?.type,
                width: this.width,
                height: this.height,
            });
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

        // 7. Release memory for consumed chunks (safe for rebuilds)
        this.releaseConsumedChunks();

        this.lastChunksFed = fed;
        return this.decodedFrames[0].clone();
    }

    /**
     * Wait until the decoded frame buffer contains a frame at or before the
     * target timestamp. The decoder runs asynchronously — frames arrive via
     * the output callback as the decoder processes its queue. We only need
     * to block until the frame we actually need is ready.
     */
    private async awaitFrameCovering(targetMicros: number): Promise<void> {
        if (!this.decoder || (this.decoder.state as string) === 'closed') return;

        const TIMEOUT_MS = 10_000;
        const start = performance.now();

        while (!this.hasFrameCovering(targetMicros)) {
            if ((this.decoder!.state as string) === 'closed') {
                throw new Error('[FrameExtractor] Decoder closed while waiting for frame');
            }

            if (performance.now() - start > TIMEOUT_MS) {
                const latestTs = this.decodedFrames.length > 0
                    ? this.decodedFrames[this.decodedFrames.length - 1].timestamp
                    : -1;
                throw new Error(
                    `[FrameExtractor] Timed out waiting for frame at ${(targetMicros / 1000).toFixed(0)}ms ` +
                    `(decoded=${this.decodedFrames.length}, latestTs=${latestTs}µs, queueSize=${this.decoder!.decodeQueueSize})`
                );
            }

            await new Promise(r => setTimeout(r, 1));
        }
    }

    /** Check if decodedFrames contains a frame at or before the target time. */
    private hasFrameCovering(targetMicros: number): boolean {
        return this.decodedFrames.some(f => f.timestamp <= targetMicros);
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
