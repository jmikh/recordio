/**
 * Runs inside Chrome. Decodes an input segment and re-encodes it under one config,
 * feeding frames at their original timestamps the way live capture delivers them.
 *
 * Two encode paths, matching the extension:
 *  - WebCodecs VideoEncoder with the screen recorder's VP9 settings (modes
 *    'variable' / 'quantizer' / 'quantizer-capped')
 *  - MediaRecorder on a video track, as the camera recorder does (mode 'mediarecorder')
 */

const KEYFRAME_INTERVAL_US = 5_000_000; // KEYFRAME_INTERVAL_SEC in videoRecorder.ts
const DECODE_AHEAD = 8;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function percentile(values, p) {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

/** VP9 frames in an IVF container (timebase 1/1000), the format ffmpeg reads back. */
function buildIvf(width, height, chunks) {
    const total = 32 + chunks.reduce((n, c) => n + 12 + c.data.byteLength, 0);
    const out = new Uint8Array(total);
    const view = new DataView(out.buffer);
    out.set([0x44, 0x4b, 0x49, 0x46], 0); // DKIF
    view.setUint16(4, 0, true);
    view.setUint16(6, 32, true);
    out.set([0x56, 0x50, 0x39, 0x30], 8); // VP90
    view.setUint16(12, width, true);
    view.setUint16(14, height, true);
    view.setUint32(16, 1000, true);
    view.setUint32(20, 1, true);
    view.setUint32(24, chunks.length, true);
    let pos = 32;
    for (const c of chunks) {
        view.setUint32(pos, c.data.byteLength, true);
        view.setBigUint64(pos + 4, BigInt(Math.round(c.timestamp / 1000)), true);
        out.set(c.data, pos + 12);
        pos += 12 + c.data.byteLength;
    }
    return out;
}

function encoderConfig(base, config) {
    if (config.mode === 'variable') return { ...base, bitrate: config.bitrate, bitrateMode: 'variable' };
    if (config.mode === 'quantizer' || config.mode === 'quantizer-capped') return { ...base, bitrateMode: 'quantizer' };
    throw new Error(`Unknown mode: ${config.mode}`);
}

async function upload(saveUrl, body) {
    const resp = await fetch(saveUrl, { method: 'POST', body });
    if (!resp.ok) throw new Error(`Saving output failed: ${resp.status}`);
}

/** Decodes the input IVF, keeping a few frames ready ahead of the caller. */
function frameSource(ivf, index, width, height) {
    const decoded = [];
    let decodeError = null;
    let wake = null;
    const notify = () => { wake?.(); wake = null; };
    const decoder = new VideoDecoder({
        output: (f) => { decoded.push(f); notify(); },
        error: (e) => { decodeError = e; notify(); },
    });
    decoder.addEventListener('dequeue', notify);
    decoder.configure({ codec: 'vp09.00.10.08', codedWidth: width, codedHeight: height });

    let nextChunk = 0;
    let flushed = false;
    function feed() {
        while (nextChunk < index.length && decoded.length + decoder.decodeQueueSize < DECODE_AHEAD) {
            const e = index[nextChunk++];
            decoder.decode(new EncodedVideoChunk({
                type: e.key ? 'key' : 'delta',
                timestamp: e.ptsUs,
                data: ivf.subarray(e.offset, e.offset + e.size),
            }));
        }
    }
    return {
        feed,
        async next() {
            for (;;) {
                if (decodeError) throw decodeError;
                if (decoded.length) return decoded.shift();
                if (nextChunk >= index.length) {
                    if (flushed) return null;
                    flushed = true;
                    await decoder.flush();
                    continue;
                }
                feed();
                await new Promise((r) => { wake = r; setTimeout(r, 20); });
            }
        },
        close: () => decoder.close(),
    };
}

/** Waits until a frame's original timestamp comes round on the wall clock. Returns false if already late. */
async function paceTo(start, firstTs, frame) {
    const wait = start + (frame.timestamp - firstTs) / 1000 - performance.now();
    if (wait > 0) await sleep(wait);
    return wait >= -34;
}

// ── WebCodecs path (screen recorder) ─────────────────────────

async function runWebCodecs({ index, width, height, config, pace, saveUrl }, source) {
    const base = { codec: 'vp09.00.31.08', width, height, framerate: 30, latencyMode: 'realtime' };
    const encConfig = encoderConfig(base, config);
    const support = await VideoEncoder.isConfigSupported(encConfig);
    if (!support.supported) throw new Error(`Encoder config not supported: ${JSON.stringify(encConfig)}`);

    const chunks = [];
    const sentAt = new Map();
    const latencies = [];
    let encodeError = null;
    const encoder = new VideoEncoder({
        output: (chunk) => {
            const data = new Uint8Array(chunk.byteLength);
            chunk.copyTo(data);
            chunks.push({ timestamp: chunk.timestamp, key: chunk.type === 'key', data });
            const t = sentAt.get(chunk.timestamp);
            if (t !== undefined) latencies.push(performance.now() - t);
        },
        error: (e) => { encodeError = e; },
    });
    encoder.configure(encConfig);

    // Soft ceiling for 'quantizer-capped' — same algorithm as extension/src/shared/screenEncoder.ts
    let quantizer = config.quantizer;
    let lastCheckTs = -Infinity;
    const quantizers = [];
    function bitsSince(fromTs) {
        let bytes = 0;
        for (let i = chunks.length - 1; i >= 0 && chunks[i].timestamp > fromTs; i--) bytes += chunks[i].data.byteLength;
        return bytes * 8;
    }

    let framesIn = 0;
    let lateFrames = 0;
    let maxQueue = 0;
    let lastKeyTs = -Infinity;
    const firstTs = index[0].ptsUs;
    const start = performance.now();

    for (;;) {
        const frame = await source.next();
        if (!frame) break;
        if (encodeError) throw encodeError;
        if (pace === 'realtime' && !(await paceTo(start, firstTs, frame))) lateFrames++;

        // Once a second: raise when both the trailing window and the last second exceed
        // the ceiling, relax once the last second is under 70% of it
        if (config.mode === 'quantizer-capped' && frame.timestamp - lastCheckTs >= 1_000_000) {
            lastCheckTs = frame.timestamp;
            const windowUs = (config.windowSec ?? 5) * 1_000_000;
            const sustainedBps = bitsSince(frame.timestamp - windowUs) / (windowUs / 1e6);
            const recentBps = bitsSince(frame.timestamp - 1_000_000);
            if (sustainedBps > config.ceilingBps && recentBps > config.ceilingBps) quantizer = Math.min(63, quantizer + 4);
            else if (recentBps < config.ceilingBps * 0.7) quantizer = Math.max(config.quantizer, quantizer - 2);
        }

        const keyFrame = frame.timestamp - lastKeyTs >= KEYFRAME_INTERVAL_US;
        if (keyFrame) lastKeyTs = frame.timestamp;
        const options = { keyFrame };
        if (config.mode !== 'variable') {
            let q = quantizer;
            if (keyFrame && config.keyframeQuantizer !== undefined) q = config.keyframeQuantizer;
            else if (keyFrame && config.keyframeQuantizerOffset !== undefined) q = Math.max(0, quantizer - config.keyframeQuantizerOffset);
            options.vp9 = { quantizer: q };
            quantizers.push(q);
        }

        sentAt.set(frame.timestamp, performance.now());
        encoder.encode(frame, options);
        frame.close();
        framesIn++;
        maxQueue = Math.max(maxQueue, encoder.encodeQueueSize);
        source.feed();
    }
    await encoder.flush();
    if (encodeError) throw encodeError;
    const wallS = (performance.now() - start) / 1000;
    encoder.close();

    const durationS = (index[index.length - 1].ptsUs - firstTs) / 1e6 || 1;
    const bytes = chunks.reduce((n, c) => n + c.data.byteLength, 0);
    let peakBps = 0;
    for (let i = 0, j = 0, windowBytes = 0; i < chunks.length; i++) {
        windowBytes += chunks[i].data.byteLength;
        while (chunks[i].timestamp - chunks[j].timestamp >= 1_000_000) windowBytes -= chunks[j++].data.byteLength;
        peakBps = Math.max(peakBps, windowBytes * 8);
    }

    await upload(saveUrl, buildIvf(width, height, chunks));

    return {
        framesIn,
        framesOut: chunks.length,
        keyframes: chunks.filter((c) => c.key).length,
        bytes,
        avgMbps: (bytes * 8) / durationS / 1e6,
        peak1sMbps: peakBps / 1e6,
        latencyMs: { p50: percentile(latencies, 0.5), p95: percentile(latencies, 0.95), max: percentile(latencies, 1) },
        maxEncodeQueue: maxQueue,
        lateFrames,
        wallS,
        quantizer: quantizers.length
            ? { min: Math.min(...quantizers), max: Math.max(...quantizers), avg: quantizers.reduce((a, b) => a + b, 0) / quantizers.length }
            : null,
    };
}

// ── MediaRecorder path (camera recorder) ─────────────────────

async function runMediaRecorder({ index, config, saveUrl }, source) {
    if (typeof MediaStreamTrackGenerator !== 'function') throw new Error('MediaStreamTrackGenerator is not available in this browser');
    const generator = new MediaStreamTrackGenerator({ kind: 'video' });
    const writer = generator.writable.getWriter();

    // The camera recorder passes only the mimeType; `bitrate` sets videoBitsPerSecond
    const options = { mimeType: 'video/webm;codecs=vp9' };
    if (config.bitrate) options.videoBitsPerSecond = config.bitrate;
    const recorder = new MediaRecorder(new MediaStream([generator]), options);
    const parts = [];
    recorder.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
    const stopped = new Promise((r) => { recorder.onstop = r; });
    recorder.start(100); // same timeslice as the extension

    // MediaRecorder timestamps frames on arrival, so it always runs at capture pace
    let framesIn = 0;
    let lateFrames = 0;
    const firstTs = index[0].ptsUs;
    const start = performance.now();
    for (;;) {
        const frame = await source.next();
        if (!frame) break;
        if (!(await paceTo(start, firstTs, frame))) lateFrames++;
        await writer.write(frame);
        frame.close();
        framesIn++;
        source.feed();
    }
    await sleep(300); // let the last frames through the encoder
    recorder.stop();
    await stopped;
    generator.stop();
    const wallS = (performance.now() - start) / 1000;

    const blob = new Blob(parts, { type: 'video/webm' });
    await upload(saveUrl, blob);

    const durationS = (index[index.length - 1].ptsUs - firstTs) / 1e6 || 1;
    return { framesIn, bytes: blob.size, avgMbps: (blob.size * 8) / durationS / 1e6, lateFrames, wallS, mimeType: recorder.mimeType };
}

/**
 * @param {{ inputUrl: string, index: {offset:number,size:number,ptsUs:number,key:boolean}[],
 *           width: number, height: number, config: object, pace: 'realtime'|'max', saveUrl: string }} job
 */
window.runConfig = async function runConfig(job) {
    const ivf = new Uint8Array(await (await fetch(job.inputUrl)).arrayBuffer());
    const source = frameSource(ivf, job.index, job.width, job.height);
    try {
        return job.config.mode === 'mediarecorder' ? await runMediaRecorder(job, source) : await runWebCodecs(job, source);
    } finally {
        source.close();
    }
};
