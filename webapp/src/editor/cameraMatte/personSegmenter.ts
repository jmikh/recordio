/**
 * Person segmentation backends for the camera matte pass.
 *
 * MODNet (WebGPU) is a real alpha matting model: clean edges and hair. It's
 * too slow without a GPU, so machines without WebGPU fall back to
 * MediaPipe's selfie segmenter (256px, softer edges, but fast on WASM).
 * Both load on first use, so neither lands in the main editor bundle.
 */
import wasmLoaderPath from '@mediapipe/tasks-vision/vision_wasm_internal.js?url';
import wasmBinaryPath from '@mediapipe/tasks-vision/vision_wasm_internal.wasm?url';

export interface PersonMask {
    /** Person alpha 0–1, row-major */
    values: Float32Array;
    width: number;
    height: number;
}

/**
 * Frames go in as they decode and come out as masks in batches: `add`
 * copies a frame into the open batch (the frame can be closed right after),
 * `takeBatch` closes it and returns the call that segments it. Preparing
 * the next batch on the CPU overlaps the GPU running the previous one.
 */
export interface PersonSegmenter {
    readonly name: string;
    /** Frames per model call */
    readonly batchSize: number;
    add(frame: VideoFrame): void;
    /** Masks in the order the frames were added; run the batches in the order they were taken. */
    takeBatch(): () => Promise<PersonMask[]>;
}

const MODNET_MODEL = 'Xenova/modnet';
/**
 * Input short edge; both dims must be multiples of 32. MODNet trains at 512;
 * on an M-series GPU (fp32, one frame per call) 512 takes ~77ms a frame,
 * 384 ~45ms and 288 ~29ms, with edges barely softer at 288.
 */
const MODNET_SHORT_EDGE = 288;
/** Frames per call: 4 brings 288 down to ~21ms a frame; larger batches gain nothing. */
const MODNET_BATCH = 4;

const MEDIAPIPE_MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/1/selfie_segmenter.tflite';
/** The model runs at 256px, so a small input loses nothing. */
const MEDIAPIPE_SHORT_EDGE = 360;

/** Draws frames into a reusable canvas at the backend's input size. */
function frameCanvas(shortEdge: number, multiple: number, readsPixels: boolean) {
    let ctx: OffscreenCanvasRenderingContext2D | null = null;
    return (frame: VideoFrame) => {
        const scale = shortEdge / Math.min(frame.displayWidth, frame.displayHeight);
        const width = Math.max(multiple, Math.round(frame.displayWidth * scale / multiple) * multiple);
        const height = Math.max(multiple, Math.round(frame.displayHeight * scale / multiple) * multiple);
        if (!ctx || ctx.canvas.width !== width || ctx.canvas.height !== height) {
            ctx = new OffscreenCanvas(width, height).getContext('2d', { alpha: false, willReadFrequently: readsPixels })!;
        }
        ctx.drawImage(frame, 0, 0, width, height);
        return ctx;
    };
}

/** The slice of WebGPU we probe (the DOM lib doesn't type navigator.gpu). */
type GpuNavigator = Navigator & { gpu?: { requestAdapter(): Promise<object | null> } };

async function createModnet(): Promise<PersonSegmenter> {
    const adapter = await (navigator as GpuNavigator).gpu?.requestAdapter();
    if (!adapter) throw new Error('WebGPU unavailable');

    const { AutoModel, Tensor } = await import('@huggingface/transformers');
    // fp16 fails to load on WebGPU (ONNX Runtime error), so fp32 (~26MB, cached after first use)
    const model = await AutoModel.from_pretrained(MODNET_MODEL, { device: 'webgpu', dtype: 'fp32' });
    const draw = frameCanvas(MODNET_SHORT_EDGE, 32, true);

    interface Batch { input: Float32Array; count: number; width: number; height: number }
    let open: Batch | null = null;

    return {
        name: 'modnet',
        batchSize: MODNET_BATCH,
        add(frame) {
            const ctx = draw(frame);
            const { width, height } = ctx.canvas;
            const plane = width * height;
            open ??= { input: new Float32Array(MODNET_BATCH * 3 * plane), count: 0, width, height };
            const rgba = ctx.getImageData(0, 0, width, height).data;

            // NCHW, normalized to [-1, 1] (mean = std = 0.5)
            const { input } = open;
            const base = open.count * 3 * plane;
            for (let p = 0, i = 0; p < plane; p++, i += 4) {
                input[base + p] = rgba[i] / 127.5 - 1;
                input[base + plane + p] = rgba[i + 1] / 127.5 - 1;
                input[base + 2 * plane + p] = rgba[i + 2] / 127.5 - 1;
            }
            open.count++;
        },
        takeBatch() {
            const batch = open;
            open = null;
            if (!batch) return async () => [];
            return async () => {
                const { input, count, width, height } = batch;
                const plane = width * height;
                const { output } = await model({
                    input: new Tensor('float32', input.subarray(0, count * 3 * plane), [count, 3, height, width]),
                });
                const values = output.data as Float32Array;
                return Array.from({ length: count }, (_, i) => ({
                    values: values.subarray(i * plane, (i + 1) * plane),
                    width,
                    height,
                }));
            };
        },
    };
}

async function createMediaPipe(): Promise<PersonSegmenter> {
    const { ImageSegmenter } = await import('@mediapipe/tasks-vision');
    const create = (delegate: 'GPU' | 'CPU') => ImageSegmenter.createFromOptions(
        { wasmLoaderPath, wasmBinaryPath },
        {
            baseOptions: { modelAssetPath: MEDIAPIPE_MODEL_URL, delegate },
            runningMode: 'IMAGE',
            outputConfidenceMasks: true,
            outputCategoryMask: false,
        },
    );
    // GPU needs WebGL2, which some machines lack
    const segmenter = await create('GPU').catch(() => create('CPU'));
    const draw = frameCanvas(MEDIAPIPE_SHORT_EDGE, 2, false);
    let open: PersonMask[] = [];

    return {
        name: 'mediapipe',
        batchSize: 1,
        // Fast enough to segment right away, while the frame is open
        add(frame) {
            const result = segmenter.segment(draw(frame).canvas);
            try {
                const mask = result.confidenceMasks?.[0];
                if (!mask) throw new Error('[cameraMatte] Segmenter returned no mask');
                // Copy: the mask's buffer is released with the result
                open.push({ values: Float32Array.from(mask.getAsFloat32Array()), width: mask.width, height: mask.height });
            } finally {
                result.close();
            }
        },
        takeBatch() {
            const masks = open;
            open = [];
            return async () => masks;
        },
    };
}

let segmenterPromise: Promise<PersonSegmenter> | null = null;

export function getPersonSegmenter(): Promise<PersonSegmenter> {
    if (!segmenterPromise) {
        segmenterPromise = createModnet().catch((err) => {
            console.warn('[cameraMatte] MODNet unavailable, using MediaPipe:', err);
            return createMediaPipe();
        });
        // Let a failed load (e.g. offline) be retried on the next call
        segmenterPromise.catch(() => { segmenterPromise = null; });
    }
    return segmenterPromise;
}
