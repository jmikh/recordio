/**
 * One-time background-removal pass over a camera recording.
 *
 * Decodes every camera frame, segments the person (personSegmenter.ts), and
 * encodes just the masks as a small grayscale VP9 WebM (CameraMatteMetadata)
 * — the camera itself is never re-encoded. Every mask keeps its camera
 * frame's timestamp, so each camera frame finds its mask by timestamp.
 */
import { WebDemuxer } from 'web-demuxer';
import { Muxer, ArrayBufferTarget } from 'webm-muxer';
import { getPersonSegmenter, type PersonMask } from './personSegmenter';

/** A keyframe every ~1s at 30fps keeps seeking in the editor and export cheap (mask keyframes are small). */
const KEYFRAME_INTERVAL = 30;
/** How far (0–1) a mask value must move to count as a jump in the one-frame-delay check (the paper's ξ). */
const OFD_THRESHOLD = 0.1;
/** Max frames queued in the decoder or the encoder before feeding pauses. */
const MAX_QUEUE = 8;

const VP9 = { encoder: 'vp09.00.10.08', muxer: 'V_VP9' };
const VP8 = { encoder: 'vp8', muxer: 'V_VP8' };

async function pickCodec(width: number, height: number, bitrate: number) {
    for (const codec of [VP9, VP8]) {
        const config: VideoEncoderConfig = {
            codec: codec.encoder, width, height, bitrate,
            bitrateMode: 'variable', latencyMode: 'realtime',
        };
        const { supported } = await VideoEncoder.isConfigSupported(config);
        if (supported) return { config, muxerCodec: codec.muxer };
    }
    throw new Error('[cameraMatte] No VP9/VP8 encoder available');
}

/**
 * MODNet's "one-frame delay" (from its paper) against frame-to-frame
 * flicker: a pixel whose neighbours one frame either side agree, while it
 * jumps away from both, is noise and takes their average. Real motion
 * changes the neighbours too, so it's left alone — nothing trails behind
 * a moving person the way a running average does.
 */
function oneFrameDelay(prev: Float32Array, cur: Float32Array, next: Float32Array, out: Float32Array): Float32Array {
    for (let i = 0; i < cur.length; i++) {
        const a = prev[i];
        const b = cur[i];
        const c = next[i];
        out[i] = Math.abs(a - c) <= OFD_THRESHOLD && Math.abs(b - a) > OFD_THRESHOLD && Math.abs(b - c) > OFD_THRESHOLD
            ? (a + c) / 2
            : b;
    }
    return out;
}

async function readChunks(demuxer: WebDemuxer, signal: AbortSignal): Promise<EncodedVideoChunk[]> {
    const chunks: EncodedVideoChunk[] = [];
    const reader = demuxer.read('video').getReader();
    while (true) {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
        const { done, value } = await reader.read();
        if (done || !value) break;
        chunks.push(value);
    }
    return chunks;
}

/** Computes the camera's person-mask video; resolves to the WebM to upload. */
export async function computeCameraMatte(
    cameraUrl: string,
    opts: { signal: AbortSignal; onProgress: (fraction: number) => void },
): Promise<Blob> {
    const { signal, onProgress } = opts;
    const t0 = performance.now();

    const [segmenter, cameraBlob] = await Promise.all([
        getPersonSegmenter(),
        fetch(cameraUrl).then(r => r.blob()),
    ]);

    // web-demuxer picks the container from the file extension
    const demuxer = new WebDemuxer({ wasmFilePath: new URL('/web-demuxer.wasm', window.location.origin).href });
    const isMP4 = /mp4|quicktime/.test(cameraBlob.type);

    // Built from the first mask — the model's output size is the mask video's size
    interface Encoding {
        encoder: VideoEncoder;
        muxer: Muxer<ArrayBufferTarget>;
        ctx: OffscreenCanvasRenderingContext2D;
        image: ImageData;
    }
    // A holder, not a `let`: it's assigned inside the decoder callback
    const built: { encoding?: Encoding } = {};
    let decoder: VideoDecoder | undefined;
    let failure: unknown = null;
    const fail = (e: unknown) => { failure ??= e; };
    const throwIfStopped = () => {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
        if (failure) throw failure;
    };

    try {
        await demuxer.load(new File([cameraBlob], isMP4 ? 'camera.mp4' : 'camera.webm', { type: cameraBlob.type || 'video/webm' }));
        const decoderConfig = await demuxer.getDecoderConfig('video');
        const chunks = await readChunks(demuxer, signal);
        if (chunks.length === 0) throw new Error('[cameraMatte] Camera video has no frames');

        const setup = async (width: number, height: number): Promise<Encoding> => {
            const bitrate = Math.min(1_000_000, Math.max(150_000, width * height * 30 * 0.03));
            const { config, muxerCodec } = await pickCodec(width, height, bitrate);
            const muxer = new Muxer({
                target: new ArrayBufferTarget(),
                video: { codec: muxerCodec, width, height },
                // Keep the camera's own timestamps, so masks and camera frames pair up
                firstTimestampBehavior: 'permissive',
            });
            const encoder = new VideoEncoder({
                output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
                error: fail,
            });
            encoder.configure(config);
            console.log(`[cameraMatte] ${segmenter.name} masks ${width}x${height}, ` +
                `${config.codec} @ ${(bitrate / 1000).toFixed(0)}kbps, ${chunks.length} frames`);

            built.encoding = {
                encoder,
                muxer,
                ctx: new OffscreenCanvas(width, height).getContext('2d')!,
                image: new ImageData(width, height),
            };
            return built.encoding;
        };

        let frameIndex = 0;

        interface FrameTime { timestamp: number; duration: number | null }
        const encodeMask = async (values: Float32Array, width: number, height: number, time: FrameTime) => {
            const { encoder, ctx, image } = built.encoding ?? await setup(width, height);
            if (width !== image.width || height !== image.height) {
                throw new Error('[cameraMatte] Mask size changed mid-video');
            }

            const data = image.data;
            for (let i = 0; i < values.length; i++) {
                const o = i * 4;
                data[o] = data[o + 1] = data[o + 2] = values[i] * 255;
                data[o + 3] = 255;
            }
            ctx.putImageData(image, 0, 0);

            const maskFrame = new VideoFrame(ctx.canvas, {
                // WebM stores whole ms, and web-demuxer reads them back with float
                // truncation (1033ms → 1032999µs); re-encoded as-is that floors to
                // 1032ms. Rounding keeps the mask's timecode identical to the camera's.
                timestamp: Math.round(time.timestamp / 1000) * 1000,
                duration: time.duration ?? undefined,
            });
            encoder.encode(maskFrame, { keyFrame: frameIndex % KEYFRAME_INTERVAL === 0 });
            maskFrame.close();

            frameIndex++;
            onProgress(frameIndex / chunks.length);
        };

        // Each mask is written one frame late: the one-frame-delay check
        // needs its successor. (A holder, not `let`s: assigned in callbacks.)
        interface RawMask { mask: PersonMask; time: FrameTime }
        const ofd: { previous?: RawMask; current?: RawMask; scratch?: Float32Array } = {};
        const pushMask = async (mask: PersonMask, time: FrameTime) => {
            const { previous, current } = ofd;
            if (current) {
                let values = current.mask.values;
                if (previous) {
                    if (ofd.scratch?.length !== values.length) ofd.scratch = new Float32Array(values.length);
                    values = oneFrameDelay(previous.mask.values, values, mask.values, ofd.scratch);
                }
                await encodeMask(values, current.mask.width, current.mask.height, current.time);
            }
            ofd.previous = current;
            ofd.current = { mask, time };
        };

        // Each decoded frame is copied into the segmenter's open batch and
        // closed at once. Full batches run through a promise chain, so masks
        // are encoded in decode order while the next batch is being prepared.
        let openTimes: FrameTime[] = [];
        let queuedBatches = 0;
        let pending: Promise<void> = Promise.resolve();
        const queueBatch = () => {
            const times = openTimes;
            openTimes = [];
            const segment = segmenter.takeBatch();
            queuedBatches++;
            pending = pending
                .then(async () => {
                    if (failure || signal.aborted) return;
                    const masks = await segment();
                    for (let i = 0; i < masks.length; i++) await pushMask(masks[i], times[i]);
                })
                .catch(fail)
                .finally(() => { queuedBatches--; });
        };

        decoder = new VideoDecoder({
            output: (frame) => {
                try {
                    if (failure || signal.aborted) return;
                    segmenter.add(frame);
                    openTimes.push({ timestamp: frame.timestamp, duration: frame.duration });
                    if (openTimes.length === segmenter.batchSize) queueBatch();
                } catch (e) {
                    fail(e);
                } finally {
                    frame.close();
                }
            },
            error: fail,
        });
        decoder.configure(decoderConfig);

        // Two batches queued keep the GPU busy; more would only hold memory
        const backpressure = () => decoder!.decodeQueueSize > MAX_QUEUE
            || queuedBatches > 1
            || (built.encoding?.encoder.encodeQueueSize ?? 0) > MAX_QUEUE;

        for (const chunk of chunks) {
            throwIfStopped();
            while (backpressure()) await new Promise(r => setTimeout(r, 0));
            decoder.decode(chunk);
        }
        await decoder.flush();
        if (openTimes.length > 0) queueBatch();
        await pending;
        throwIfStopped();
        // The last mask has no successor to check against
        const last = ofd.current;
        if (last) await encodeMask(last.mask.values, last.mask.width, last.mask.height, last.time);
        const { encoding } = built;
        if (!encoding) throw new Error('[cameraMatte] No frames decoded');

        await encoding.encoder.flush();
        throwIfStopped();
        encoding.muxer.finalize();

        const blob = new Blob([encoding.muxer.target.buffer], { type: 'video/webm' });
        console.log(`[cameraMatte] ${frameIndex} masks in ${((performance.now() - t0) / 1000).toFixed(1)}s, ` +
            `${(blob.size / 1024 / 1024).toFixed(1)}MB`);
        return blob;
    } finally {
        if (decoder && decoder.state !== 'closed') decoder.close();
        const encoder = built.encoding?.encoder;
        if (encoder && encoder.state !== 'closed') encoder.close();
        try { demuxer.destroy(); } catch { /* already destroyed */ }
    }
}
