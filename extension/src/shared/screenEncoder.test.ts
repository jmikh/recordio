import { describe, it, expect, vi, afterEach } from 'vitest';
import { ScreenRateControl } from './screenEncoder';

const FRAME_US = 33_333;

function stubQuantizerSupport(supported: boolean) {
    vi.stubGlobal('VideoEncoder', { isConfigSupported: vi.fn(async () => ({ supported })) });
}

/** Feed `seconds` of 30fps frames whose encoded size works out to `bps`, starting at `startUs`. Returns the last options. */
function run(rc: ScreenRateControl, startUs: number, seconds: number, bps: number) {
    const bytesPerFrame = bps / 8 / 30;
    let options = rc.encodeOptions(startUs, false);
    for (let t = startUs; t < startUs + seconds * 1_000_000; t += FRAME_US) {
        options = rc.encodeOptions(t, false);
        rc.onChunk(t, bytesPerFrame);
    }
    return options;
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('ScreenRateControl', () => {
    it('uses quantizer mode with a better quantizer on keyframes', async () => {
        stubQuantizerSupport(true);
        const rc = await ScreenRateControl.create(3456, 1992, 5);

        expect(rc.config).toMatchObject({ codec: 'vp09.00.31.08', bitrateMode: 'quantizer', latencyMode: 'realtime' });
        expect(rc.encodeOptions(0, true)).toEqual({ keyFrame: true, vp9: { quantizer: 26 } });
        expect(rc.encodeOptions(FRAME_US, false)).toEqual({ keyFrame: false, vp9: { quantizer: 32 } });
    });

    it('falls back to the previous 16 Mbps variable config when quantizer mode is unsupported', async () => {
        stubQuantizerSupport(false);
        const rc = await ScreenRateControl.create(3456, 1992, 5);

        expect(rc.config).toMatchObject({ bitrateMode: 'variable', bitrate: 16_000_000 });
        expect(rc.encodeOptions(0, true)).toEqual({ keyFrame: true });
        expect(rc.info()).toMatchObject({ preset: 'vp9-vbr16m', bitrateMode: 'variable' });
    });

    it('falls back when the support check throws', async () => {
        vi.stubGlobal('VideoEncoder', { isConfigSupported: vi.fn(async () => { throw new Error('nope'); }) });
        const rc = await ScreenRateControl.create(1920, 1080, 5);

        expect(rc.mode).toBe('variable');
    });

    it('stays at the base quantizer below the cap', async () => {
        stubQuantizerSupport(true);
        const rc = await ScreenRateControl.create(3456, 1992, 5);

        expect(run(rc, 0, 20, 12_000_000).vp9?.quantizer).toBe(32);
        expect(rc.info()).toMatchObject({ maxQuantizer: 32, cappedMs: 0 });
    });

    it('ignores a one-second burst above the cap', async () => {
        stubQuantizerSupport(true);
        const rc = await ScreenRateControl.create(3456, 1992, 5);

        run(rc, 0, 4, 4_000_000);
        run(rc, 4_000_000, 1, 40_000_000);
        expect(run(rc, 5_000_000, 3, 4_000_000).vp9?.quantizer).toBe(32);
    });

    it('raises the quantizer under sustained load and relaxes back afterwards', async () => {
        stubQuantizerSupport(true);
        const rc = await ScreenRateControl.create(3456, 1992, 5);

        const loaded = run(rc, 0, 10, 30_000_000);
        expect(loaded.vp9!.quantizer).toBeGreaterThan(32);

        const relaxed = run(rc, 10_000_000, 20, 2_000_000);
        expect(relaxed.vp9?.quantizer).toBe(32);

        const info = rc.info();
        expect(info.maxQuantizer).toBeGreaterThan(32);
        expect(info.cappedMs).toBeGreaterThan(0);
    });

    it('keeps keyframes better than delta frames while capped', async () => {
        stubQuantizerSupport(true);
        const rc = await ScreenRateControl.create(3456, 1992, 5);

        const delta = run(rc, 0, 10, 30_000_000).vp9!.quantizer;
        const key = rc.encodeOptions(10_000_000, true).vp9!.quantizer;
        expect(key).toBe(delta - 6);
    });

    it('records encoded bytes and settings for analysis', async () => {
        stubQuantizerSupport(true);
        const rc = await ScreenRateControl.create(3456, 1992, 5);
        rc.onChunk(0, 1000);
        rc.onChunk(FRAME_US, 500);

        expect(rc.info()).toEqual({
            preset: 'vp9-q32-cap16m',
            codec: 'vp09.00.31.08',
            bitrateMode: 'quantizer',
            keyframeIntervalSec: 5,
            encodedBytes: 1500,
            quantizer: 32,
            keyframeQuantizer: 26,
            bitrateCapBps: 16_000_000,
            maxQuantizer: 32,
            cappedMs: 0,
        });
    });
});
