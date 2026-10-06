/**
 * Plays the camera's person mask in the editor, frame-locked to the camera.
 *
 * A second <video> would drift from the camera's by a frame or more, which
 * shows as a halo whenever the person moves. Instead the render loop
 * snapshots the camera frame it's about to draw (`new VideoFrame(video)`
 * carries that frame's exact timestamp) and pairs it with the mask of the
 * same timestamp. Masks are decoded with WebCodecs a little ahead of the
 * playhead; the mask file is small, so all its encoded chunks stay in memory.
 */
import { WebDemuxer } from 'web-demuxer';
import { getActiveCameraMatte } from '@shared/utils/cameraMatte';
import type { Project } from '@shared/types';

/** Masks decoded ahead of the playhead. */
const LOOKAHEAD_FRAMES = 15;
/** Max chunks waiting in the decoder at once. */
const MAX_DECODE_QUEUE = 8;
/** Timestamps this close are the same frame (containers round to whole ms). */
const TOLERANCE_US = 1000;

/** A camera frame and the mask with its timestamp. */
export interface CameraMaskPair {
    color: VideoFrame;
    mask: VideoFrame;
}

export class MaskPlayer {
    private readonly timestamps: number[];
    private decoder: VideoDecoder;
    /** Decoded masks in timestamp order, from the newest one asked for onwards */
    private decoded: VideoFrame[] = [];
    /** The last exactly matched pair — owned here, shown until a newer one exists */
    private lastPair: CameraMaskPair | null = null;
    private nextChunk = 0;
    /** First chunk fed since the last seek */
    private runStart = 0;
    /** The decoder holds its last frames until flushed — done once the final chunk is fed */
    private flushed = false;

    private constructor(
        readonly storagePath: string,
        private readonly chunks: EncodedVideoChunk[],
        private readonly config: VideoDecoderConfig,
    ) {
        this.timestamps = chunks.map(c => c.timestamp);
        this.decoder = this.createDecoder();
    }

    static async load(url: string, storagePath: string): Promise<MaskPlayer> {
        const blob = await (await fetch(url)).blob();
        const demuxer = new WebDemuxer({ wasmFilePath: new URL('/web-demuxer.wasm', window.location.origin).href });
        try {
            await demuxer.load(new File([blob], 'mask.webm', { type: 'video/webm' }));
            const config = await demuxer.getDecoderConfig('video');
            const chunks: EncodedVideoChunk[] = [];
            const reader = demuxer.read('video').getReader();
            for (;;) {
                const { done, value } = await reader.read();
                if (done || !value) break;
                chunks.push(value);
            }
            if (chunks.length === 0) throw new Error('[MaskPlayer] Mask video has no frames');
            return new MaskPlayer(storagePath, chunks, config);
        } finally {
            try { demuxer.destroy(); } catch { /* already destroyed */ }
        }
    }

    private createDecoder(): VideoDecoder {
        const decoder = new VideoDecoder({
            output: frame => this.decoded.push(frame),
            error: err => console.error('[MaskPlayer] Decode error:', err),
        });
        decoder.configure(this.config);
        return decoder;
    }

    /** Index of the last chunk at or before `timestampUs` (0 if none). */
    private indexAt(timestampUs: number): number {
        let lo = 0;
        let hi = this.timestamps.length - 1;
        while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (this.timestamps[mid] <= timestampUs) lo = mid;
            else hi = mid - 1;
        }
        return lo;
    }

    /** Index of the keyframe at or before chunk `index`. */
    private keyAtOrBefore(index: number): number {
        let key = index;
        while (key > 0 && this.chunks[key].type !== 'key') key--;
        return key;
    }

    /** Restart decoding from keyframe chunk `key`. */
    private seek(key: number): void {
        if (this.decoder.state === 'closed') this.decoder = this.createDecoder();
        else {
            this.decoder.reset();
            this.decoder.configure(this.config);
        }
        for (const frame of this.decoded) frame.close();
        this.decoded = [];
        this.nextChunk = key;
        this.runStart = key;
        this.flushed = false;
    }

    /**
     * The mask with exactly `timestampUs`, or null while it's still decoding
     * (e.g. right after a seek). Valid until the next call.
     */
    private frameAt(timestampUs: number): VideoFrame | null {
        const target = this.indexAt(timestampUs + TOLERANCE_US);
        const targetTs = this.timestamps[target];

        // Seek when the target is behind what's decoded, or when its keyframe
        // lies past the decode position (decoding up to it would be wasted)
        const key = this.keyAtOrBefore(target);
        const oldest = this.decoded[0]?.timestamp;
        const behind = oldest !== undefined ? oldest > targetTs + TOLERANCE_US : target < this.runStart;
        if (this.decoder.state === 'closed' || behind || key > this.nextChunk) this.seek(key);

        while (this.nextChunk < this.chunks.length
            && this.nextChunk <= target + LOOKAHEAD_FRAMES
            && this.decoder.decodeQueueSize < MAX_DECODE_QUEUE) {
            this.decoder.decode(this.chunks[this.nextChunk++]);
        }
        if (this.nextChunk === this.chunks.length && !this.flushed) {
            this.flushed = true;
            // Rejected when a seek resets the decoder mid-flush — that's fine
            this.decoder.flush().catch(() => {});
        }

        // The newest decoded mask at or before the target; older ones are done
        let best = -1;
        for (let i = 0; i < this.decoded.length && this.decoded[i].timestamp <= targetTs + TOLERANCE_US; i++) best = i;
        if (best === -1) return null;
        for (const frame of this.decoded.splice(0, best)) frame.close();
        const mask = this.decoded[0];
        return Math.abs(mask.timestamp - timestampUs) <= TOLERANCE_US ? mask : null;
    }

    /**
     * The camera frame and mask to draw now. Mid-seek the camera <video> has
     * no frame to snapshot, and right after a seek the exact mask may still be
     * decoding — then the last exact pair is kept (the frame the video was
     * showing anyway), so the camera never flashes back to its background.
     * Null only until the first pair. Owned by the player: don't close.
     */
    pairFor(video: HTMLVideoElement): CameraMaskPair | null {
        if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return this.lastPair;
        let color: VideoFrame;
        try {
            color = new VideoFrame(video);
        } catch {
            return this.lastPair;
        }
        if (color.timestamp === this.lastPair?.color.timestamp) {
            color.close();
            return this.lastPair;
        }
        const mask = this.frameAt(color.timestamp);
        if (!mask) {
            color.close();
            return this.lastPair;
        }
        this.closePair();
        // A clone, so the decode window can move on without closing it
        this.lastPair = { color, mask: mask.clone() };
        return this.lastPair;
    }

    private closePair(): void {
        this.lastPair?.color.close();
        this.lastPair?.mask.close();
        this.lastPair = null;
    }

    dispose(): void {
        if (this.decoder.state !== 'closed') this.decoder.close();
        for (const frame of this.decoded) frame.close();
        this.decoded = [];
        this.closePair();
    }
}

/**
 * Video refs for one editor frame. While background removal is active and
 * the mask player is ready, the camera entry becomes a snapshot of the frame
 * the camera <video> is showing and the mask entry the mask with that
 * frame's timestamp — a snapshot is the drawn frame exactly, where the
 * video's currentTime can be a frame off.
 */
export function withCameraMask(
    project: Project,
    videoRefs: { [storagePath: string]: HTMLVideoElement },
    maskPlayer: MaskPlayer | null,
): { [storagePath: string]: CanvasImageSource } {
    const matte = getActiveCameraMatte(project);
    const camera = project.cameraSource;
    if (!matte || !camera || maskPlayer?.storagePath !== matte.storagePath) return videoRefs;

    const video = videoRefs[camera.storagePath];
    const pair = video ? maskPlayer.pairFor(video) : null;
    if (!pair) return videoRefs;
    return { ...videoRefs, [camera.storagePath]: pair.color, [matte.storagePath]: pair.mask };
}
