/**
 * Encoder configs compared by run.mjs. Every config uses the recorder's base
 * settings (vp09.00.31.08, realtime, 30fps, keyframe every 5s — see
 * extension/src/shared/videoRecorder.ts); only rate control differs.
 *
 * mode:
 *   'variable'          — bitrateMode 'variable' with `bitrate` (the recorder before screenEncoder.ts)
 *   'quantizer'         — bitrateMode 'quantizer', fixed per-frame VP9 `quantizer` (0–63, lower = better)
 *   'quantizer-capped'  — 'quantizer' plus the recorder's soft cap: once a second, raise the
 *                         quantizer while both the trailing `windowSec` and the last second
 *                         exceed `ceilingBps`; relax back to `quantizer` below 70% of it
 * keyframeQuantizer (optional)       — absolute quantizer for keyframes
 * keyframeQuantizerOffset (optional) — keyframes use (current quantizer − offset)
 */
export default [
    { name: 'current-vbr16M', mode: 'variable', bitrate: 16_000_000 },
    { name: 'vbr8M', mode: 'variable', bitrate: 8_000_000 },
    { name: 'q24', mode: 'quantizer', quantizer: 24 },
    { name: 'q32', mode: 'quantizer', quantizer: 32 },
    { name: 'q40', mode: 'quantizer', quantizer: 40 },
    { name: 'q32-kf26', mode: 'quantizer', quantizer: 32, keyframeQuantizer: 26 },
    // What the recorder ships (extension/src/shared/screenEncoder.ts)
    { name: 'recorder-q32-cap16M', mode: 'quantizer-capped', quantizer: 32, keyframeQuantizerOffset: 6, ceilingBps: 16_000_000, windowSec: 5 },
    // Same algorithm with a low ceiling, to see quality when the cap actually engages
    { name: 'stress-q32-cap4M', mode: 'quantizer-capped', quantizer: 32, keyframeQuantizerOffset: 6, ceilingBps: 4_000_000, windowSec: 5 },
];
