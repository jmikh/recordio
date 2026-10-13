/**
 * Camera configs for run.mjs. 'mediarecorder' runs the camera recorder's path
 * (MediaRecorder, video/webm;codecs=vp9, 100 ms timeslice — see videoRecorder.ts);
 * `bitrate` sets videoBitsPerSecond, omitted = Chrome's default (what ships today).
 * The WebCodecs quantizer rows are for comparison (see configs.mjs for modes).
 *
 * Score as displayed with: --display-filter "crop=1080:1080,scale=300:300"
 * (the 300 px camera bubble on a 1920-wide output)
 */
export default [
    { name: 'mr-default', mode: 'mediarecorder' },
    { name: 'mr-1.5M', mode: 'mediarecorder', bitrate: 1_500_000 },
    { name: 'mr-1M', mode: 'mediarecorder', bitrate: 1_000_000 },
    { name: 'mr-0.75M', mode: 'mediarecorder', bitrate: 750_000 },
    { name: 'wc-q32', mode: 'quantizer', quantizer: 32 },
    { name: 'wc-q40', mode: 'quantizer', quantizer: 40 },
];
