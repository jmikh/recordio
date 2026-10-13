/**
 * Screen VP9 rate control for the recorder.
 *
 * Uses WebCodecs quantizer mode (fixed quality per frame) instead of a bitrate
 * target. Against the previous 16 Mbps variable-bitrate config this measured
 * 15–63% smaller depending on content, and heavy motion no longer drops quality
 * (scripts/encoder-bench).
 *
 * Quantizer mode has no size ceiling, so a soft cap keeps the worst case at the
 * old 16 Mbps: once a second, if both the last 5 s and the last 1 s of output
 * exceed the cap, the quantizer rises; it relaxes back once output falls well
 * below. Requiring both windows ignores one-second bursts (page loads) and stops
 * the quantizer winding up after the burst has passed.
 *
 * Falls back to the previous config when quantizer mode isn't supported.
 */

import type { ScreenEncoderInfo } from '@shared/types';

export const SCREEN_CODEC = 'vp09.00.31.08';

/** VP9 quantizer, 0–63, lower = better */
const BASE_QUANTIZER = 32;
/** Keyframes get a better quantizer — every frame until the next keyframe is built from them */
const KEYFRAME_QUANTIZER_OFFSET = 6;
const MAX_QUANTIZER = 63;

const CAP_BPS = 16_000_000;
const CAP_WINDOW_US = 5_000_000;
const CHECK_INTERVAL_US = 1_000_000;
const CAP_STEP_UP = 4;
const CAP_STEP_DOWN = 2;
const CAP_RELAX_RATIO = 0.7;

/** Previous config, still used when quantizer mode isn't available */
const FALLBACK_BITRATE = 16_000_000;

/** Per-frame VP9 quantizer isn't in TypeScript's DOM lib yet */
export type ScreenEncodeOptions = VideoEncoderEncodeOptions & { vp9?: { quantizer: number } };

export class ScreenRateControl {
    private quantizer = BASE_QUANTIZER;
    private maxQuantizer = BASE_QUANTIZER;
    private cappedUs = 0;
    private lastCheckUs: number | null = null;
    private recentChunks: { timestampUs: number; bytes: number }[] = [];
    private encodedBytes = 0;

    private constructor(
        readonly config: VideoEncoderConfig,
        readonly mode: 'quantizer' | 'variable',
        private readonly keyframeIntervalSec: number,
    ) {}

    static async create(width: number, height: number, keyframeIntervalSec: number): Promise<ScreenRateControl> {
        const base = { codec: SCREEN_CODEC, width, height, framerate: 30, latencyMode: 'realtime' as const };
        const quantizerConfig: VideoEncoderConfig = { ...base, bitrateMode: 'quantizer' };
        const supported = await VideoEncoder.isConfigSupported(quantizerConfig).then((s) => !!s.supported, () => false);
        return supported
            ? new ScreenRateControl(quantizerConfig, 'quantizer', keyframeIntervalSec)
            : new ScreenRateControl({ ...base, bitrate: FALLBACK_BITRATE, bitrateMode: 'variable' }, 'variable', keyframeIntervalSec);
    }

    /** Call from the encoder's output callback. */
    onChunk(timestampUs: number, bytes: number): void {
        this.encodedBytes += bytes;
        if (this.mode === 'quantizer') this.recentChunks.push({ timestampUs, bytes });
    }

    /**
     * Options for encoding the frame at `timestampUs`. In quantizer mode every frame
     * must carry a quantizer — Chrome doesn't error without one, it silently encodes
     * that frame at very low quality.
     */
    encodeOptions(timestampUs: number, keyFrame: boolean): ScreenEncodeOptions {
        if (this.mode === 'variable') return { keyFrame };
        this.applyCap(timestampUs);
        const quantizer = keyFrame ? Math.max(0, this.quantizer - KEYFRAME_QUANTIZER_OFFSET) : this.quantizer;
        return { keyFrame, vp9: { quantizer } };
    }

    /** What was used and how it went, stored on the recording's ScreenMetadata. */
    info(): ScreenEncoderInfo {
        const common = { codec: SCREEN_CODEC, keyframeIntervalSec: this.keyframeIntervalSec, encodedBytes: this.encodedBytes };
        if (this.mode === 'variable') {
            return { preset: 'vp9-vbr16m', bitrateMode: 'variable', bitrate: FALLBACK_BITRATE, ...common };
        }
        return {
            preset: 'vp9-q32-cap16m',
            bitrateMode: 'quantizer',
            ...common,
            quantizer: BASE_QUANTIZER,
            keyframeQuantizer: BASE_QUANTIZER - KEYFRAME_QUANTIZER_OFFSET,
            bitrateCapBps: CAP_BPS,
            maxQuantizer: this.maxQuantizer,
            cappedMs: Math.round(this.cappedUs / 1000),
        };
    }

    private applyCap(nowUs: number): void {
        if (this.lastCheckUs !== null && nowUs - this.lastCheckUs < CHECK_INTERVAL_US) return;
        if (this.lastCheckUs !== null && this.quantizer > BASE_QUANTIZER) this.cappedUs += nowUs - this.lastCheckUs;
        this.lastCheckUs = nowUs;

        this.recentChunks = this.recentChunks.filter((c) => c.timestampUs > nowUs - CAP_WINDOW_US);
        const bitsSince = (fromUs: number) =>
            this.recentChunks.reduce((n, c) => (c.timestampUs > fromUs ? n + c.bytes * 8 : n), 0);
        const sustainedBps = bitsSince(nowUs - CAP_WINDOW_US) / (CAP_WINDOW_US / 1e6);
        const recentBps = bitsSince(nowUs - CHECK_INTERVAL_US) / (CHECK_INTERVAL_US / 1e6);

        if (sustainedBps > CAP_BPS && recentBps > CAP_BPS) {
            this.quantizer = Math.min(MAX_QUANTIZER, this.quantizer + CAP_STEP_UP);
        } else if (recentBps < CAP_BPS * CAP_RELAX_RATIO && this.quantizer > BASE_QUANTIZER) {
            this.quantizer = Math.max(BASE_QUANTIZER, this.quantizer - CAP_STEP_DOWN);
        }
        this.maxQuantizer = Math.max(this.maxQuantizer, this.quantizer);
    }
}
