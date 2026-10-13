#!/usr/bin/env node
/**
 * Encoder bench — compares recorder encoder settings on real recordings.
 *
 * Each input segment is decoded in Chrome and re-encoded the way the extension
 * records — WebCodecs with the screen recorder's VP9 config (configs.mjs), or
 * MediaRecorder like the camera recorder (configs-camera.mjs) — with frames fed at
 * their original timestamps like live capture. Reports size, peak bitrate, encode
 * latency/queue (does it keep up live?), browser CPU, and SSIM/PSNR vs the input.
 *
 *   node scripts/encoder-bench/run.mjs <recording.webm[@startSec+durationSec]>... [options]
 *
 *   --configs <file.mjs>     configs module (default: scripts/encoder-bench/configs.mjs)
 *   --only <a,b>             run only these config names
 *   --pace realtime|max      feed frames at capture pace (default) or as fast as possible (WebCodecs only)
 *   --crop x:y:w:h@sec       also save a PNG stacking this crop from the input and each output
 *   --display-filter <vf>    also score quality after this ffmpeg filter, i.e. as displayed
 *                            (camera bubble: "crop=1080:1080,scale=300:300")
 *   --out <dir>              output dir (default: $TMPDIR/encoder-bench-<timestamp>)
 *
 * Inputs must be VP9 (the recorder's .webm). Default segment: first 30s.
 * Caveat: inputs are already compressed, so absolute sizes are optimistic vs raw
 * capture — compare configs against each other, not against the original file.
 * Requires ffmpeg/ffprobe on PATH; uses installed Google Chrome, else Playwright Chromium.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const HERE = path.dirname(new URL(import.meta.url).pathname);

// ── Args ──────────────────────────────────────────────────────

const args = process.argv.slice(2);
const opt = (name, fallback) => {
    const i = args.indexOf(`--${name}`);
    if (i === -1) return fallback;
    const [value] = args.splice(i, 2).slice(1);
    return value;
};
const configsPath = path.resolve(opt('configs', path.join(HERE, 'configs.mjs')));
const only = opt('only', null)?.split(',');
const pace = opt('pace', 'realtime');
const crop = opt('crop', null);
const displayFilter = opt('display-filter', null);
const outDir = path.resolve(opt('out', path.join(os.tmpdir(), `encoder-bench-${new Date().toISOString().replace(/[:.]/g, '-')}`)));
const inputs = args;

if (inputs.length === 0) {
    console.error('Usage: node scripts/encoder-bench/run.mjs <recording.webm[@start+duration]>... [--configs f] [--only a,b] [--pace realtime|max] [--crop x:y:w:h@sec] [--out dir]');
    process.exit(1);
}

const allConfigs = (await import(pathToFileURL(configsPath).href)).default;
const configs = only ? allConfigs.filter((c) => only.includes(c.name)) : allConfigs;
fs.mkdirSync(outDir, { recursive: true });

// ── Helpers ───────────────────────────────────────────────────

const run = (cmd, cmdArgs) => execFileSync(cmd, cmdArgs, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

/** Cut a segment to IVF (stream copy) and index its frames for the page. */
function prepareInput(spec) {
    const [file, range = '0+30'] = spec.split('@');
    const [start, duration] = range.split('+').map(Number);
    const label = `${path.basename(file, path.extname(file))}_${start}s`;
    const ivfPath = path.join(outDir, `${label}.input.ivf`);
    run('ffmpeg', ['-v', 'error', '-y', '-ss', String(start), '-i', file, '-t', String(duration), '-an', '-c:v', 'copy', '-f', 'ivf', ivfPath]);

    const buf = fs.readFileSync(ivfPath);
    const headerSize = buf.readUInt16LE(6);
    const width = buf.readUInt16LE(12);
    const height = buf.readUInt16LE(14);
    const tbDen = buf.readUInt32LE(16);
    const tbNum = buf.readUInt32LE(20);
    const keyFlags = run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'packet=flags', '-of', 'csv=p=0', ivfPath])
        .trim().split('\n').map((f) => f.includes('K'));

    const index = [];
    for (let pos = headerSize; pos + 12 <= buf.length;) {
        const size = buf.readUInt32LE(pos);
        const pts = Number(buf.readBigUInt64LE(pos + 4));
        index.push({ offset: pos + 12, size, ptsUs: Math.round((pts * tbNum * 1e6) / tbDen), key: keyFlags[index.length] ?? false });
        pos += 12 + size;
    }
    return { label, ivfPath, width, height, index, durationS: (index.at(-1).ptsUs - index[0].ptsUs) / 1e6 };
}

/** Total CPU seconds used by a process and all its descendants (macOS/Linux `ps`). */
function treeCpuSeconds(rootPid) {
    const rows = run('ps', ['-A', '-o', 'pid=,ppid=,time=']).trim().split('\n').map((l) => l.trim().split(/\s+/));
    const children = new Map();
    const cpu = new Map();
    for (const [pid, ppid, time] of rows) {
        if (!children.has(ppid)) children.set(ppid, []);
        children.get(ppid).push(pid);
        const [days, clock] = time.includes('-') ? time.split('-') : ['0', time];
        const secs = clock.split(':').reduce((acc, part) => acc * 60 + parseFloat(part), 0);
        cpu.set(pid, Number(days) * 86400 + secs);
    }
    let total = 0;
    const stack = [String(rootPid)];
    while (stack.length) {
        const pid = stack.pop();
        total += cpu.get(pid) ?? 0;
        stack.push(...(children.get(pid) ?? []));
    }
    return total;
}

/**
 * How to pair output frames with input frames for scoring:
 *  - same frame count → by index
 *  - MediaRecorder → it stamps frames on arrival and bunches the first few at t=0,
 *    so skip the first 0.5 s and search for the time offset that lines up best
 *  - otherwise → by timestamp from each stream's start
 */
const MR_SKIP_SEC = 0.5;

function alignment(outputPath, inputIvf, sameFrameCount, isMediaRecorder) {
    if (sameFrameCount) return { out: 'settb=1/30,setpts=N', in: 'settb=1/30,setpts=N' };
    if (!isMediaRecorder) return { out: 'setpts=PTS-STARTPTS', in: 'setpts=PTS-STARTPTS' };

    const forOffset = (sec) => ({ out: `trim=start=${MR_SKIP_SEC},setpts=PTS+(${sec.toFixed(4)}/TB)`, in: 'setpts=PTS-STARTPTS' });
    const quickPsnr = (sec) => {
        const a = forOffset(sec);
        return scores(outputPath, inputIvf, a, 'scale=320:-2', ['-t', '12']).psnr;
    };
    let best = { sec: 0, psnr: -Infinity };
    for (let sec = -0.2; sec <= 0.4; sec += 1 / 30) {
        const psnr = quickPsnr(sec);
        if (psnr > best.psnr) best = { sec, psnr };
    }
    for (const sec of [best.sec - 1 / 60, best.sec + 1 / 60]) {
        const psnr = quickPsnr(sec);
        if (psnr > best.psnr) best = { sec, psnr };
    }
    return forOffset(best.sec);
}

/** SSIM/PSNR of an output vs the input under an alignment; `filter` is applied to both first. */
function scores(outputPath, inputIvf, align, filter, extraArgs = []) {
    const prep = (a) => (filter ? `${a},${filter}` : a);
    const graph = `[0:v]${prep(align.out)},split[a1][a2];[1:v]${prep(align.in)},split[b1][b2];[a1][b1]ssim;[a2][b2]psnr`;
    // ffmpeg prints the SSIM/PSNR summary on stderr
    const { stderr: log } = spawnSync('ffmpeg', ['-hide_banner', ...extraArgs, '-i', outputPath, '-i', inputIvf, '-lavfi', graph, '-f', 'null', '-'],
        { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    return {
        ssim: Number(log.match(/SSIM .*All:([\d.]+)/)?.[1] ?? NaN),
        psnr: Number(log.match(/PSNR .*average:([\d.]+|inf)/)?.[1] ?? NaN),
    };
}

/** Frame/keyframe counts and peak 1s bitrate read from a file (MediaRecorder outputs report none themselves). */
function packetStats(file) {
    const packets = run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'packet=pts_time,size,flags', '-of', 'csv=p=0', file])
        .trim().split('\n').map((l) => l.split(',')).filter((p) => p[0] !== '' && p[0] !== 'N/A')
        .map(([t, size, flags]) => ({ t: Number(t), size: Number(size), key: flags.includes('K') }));
    let peakBits = 0;
    for (let i = 0, j = 0, bits = 0; i < packets.length; i++) {
        bits += packets[i].size * 8;
        while (packets[i].t - packets[j].t >= 1) bits -= packets[j++].size * 8;
        peakBits = Math.max(peakBits, bits);
    }
    return { framesOut: packets.length, keyframes: packets.filter((p) => p.key).length, peak1sMbps: peakBits / 1e6 };
}

function saveCrops(label, inputIvf, outputs) {
    const [rect, at] = crop.split('@');
    const [x, y, w, h] = rect.split(':');
    const pngs = [inputIvf, ...outputs.map((o) => o.path)].map((src, i) => {
        const png = path.join(outDir, `${label}.crop${i}.png`);
        run('ffmpeg', ['-v', 'error', '-y', '-i', src, '-vf', `select='gte(t\\,${at})',crop=${w}:${h}:${x}:${y}`, '-frames:v', '1', png]);
        return png;
    });
    const stacked = path.join(outDir, `${label}.crops.png`);
    run('ffmpeg', ['-v', 'error', '-y', ...pngs.flatMap((p) => ['-i', p]), '-filter_complex', `vstack=inputs=${pngs.length}`, stacked]);
    pngs.forEach((p) => fs.rmSync(p));
    return stacked;
}

// ── Local server: page, inputs, and output uploads ────────────

const prepared = inputs.map(prepareInput);
const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        return res.end('<!doctype html><link rel="icon" href="data:,"><script src="/page.js"></script>');
    }
    if (url.pathname === '/page.js') {
        res.writeHead(200, { 'Content-Type': 'text/javascript' });
        return res.end(fs.readFileSync(path.join(HERE, 'page.js')));
    }
    if (req.method === 'GET' && url.pathname.startsWith('/input/')) {
        const input = prepared.find((p) => p.label === path.basename(url.pathname));
        if (!input) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
        return fs.createReadStream(input.ivfPath).pipe(res);
    }
    if (req.method === 'POST' && url.pathname.startsWith('/save/')) {
        const file = fs.createWriteStream(path.join(outDir, path.basename(url.pathname)));
        req.pipe(file).on('finish', () => { res.writeHead(200); res.end(); });
        return;
    }
    res.writeHead(404);
    res.end();
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://localhost:${server.address().port}`;

// ── Browser ───────────────────────────────────────────────────

const launchOpts = { headless: false, args: ['--headless=new'] };
let browserServer;
try {
    browserServer = await chromium.launchServer({ ...launchOpts, channel: 'chrome' });
} catch {
    browserServer = await chromium.launchServer(launchOpts);
}
const browser = await chromium.connect(browserServer.wsEndpoint());
const browserPid = browserServer.process().pid;
const page = await browser.newPage();
page.on('console', (m) => { if (m.type() === 'error') console.error(`[page] ${m.text()}`); });
await page.goto(origin);

const env = { browser: browser.version(), platform: `${os.platform()} ${os.arch()}`, cpu: os.cpus()[0]?.model, pace };
console.log(`Chrome ${env.browser} on ${env.cpu} — pace=${pace} — out: ${outDir}\n`);

// ── Run ───────────────────────────────────────────────────────

const results = [];
for (const input of prepared) {
    const inputBytes = input.index.reduce((n, e) => n + e.size, 0);
    console.log(`${input.label}: ${input.width}x${input.height}, ${input.index.length} frames, ${input.durationS.toFixed(1)}s, input ${(inputBytes * 8 / input.durationS / 1e6).toFixed(1)} Mbps`);
    const outputs = [];
    for (const config of configs) {
        const isMediaRecorder = config.mode === 'mediarecorder';
        const outName = `${input.label}.${config.name}.${isMediaRecorder ? 'webm' : 'ivf'}`;
        const cpuBefore = treeCpuSeconds(browserPid);
        const stats = await page.evaluate((job) => window.runConfig(job), {
            inputUrl: `${origin}/input/${input.label}`,
            index: input.index,
            width: input.width,
            height: input.height,
            config,
            pace,
            saveUrl: `${origin}/save/${outName}`,
        });
        const cpuS = treeCpuSeconds(browserPid) - cpuBefore;
        const outPath = path.join(outDir, outName);
        if (isMediaRecorder) Object.assign(stats, packetStats(outPath));
        const align = alignment(outPath, input.ivfPath, stats.framesOut === input.index.length, isMediaRecorder);
        const q = scores(outPath, input.ivfPath, align);
        const shown = displayFilter ? scores(outPath, input.ivfPath, align, displayFilter) : null;
        const row = { input: input.label, config: config.name, ...stats, cpuS, cpuCores: cpuS / stats.wallS, ...q,
            ...(shown && { displaySsim: shown.ssim, displayPsnr: shown.psnr }) };
        results.push(row);
        outputs.push({ path: outPath });
        console.log(`  ${config.name.padEnd(16)} ${(stats.bytes / 1e6).toFixed(1).padStart(6)} MB  avg ${stats.avgMbps.toFixed(2).padStart(5)} Mbps  peak ${stats.peak1sMbps.toFixed(1).padStart(5)}  ` +
            `SSIM ${q.ssim.toFixed(4)}  PSNR ${q.psnr.toFixed(1)}` +
            (shown ? `  shown SSIM ${shown.ssim.toFixed(4)} PSNR ${shown.psnr.toFixed(1)}` : '') +
            (stats.latencyMs ? `  latency p95 ${stats.latencyMs.p95.toFixed(0)}ms  queue ${stats.maxEncodeQueue}` : '') +
            `  cpu ${(cpuS / stats.wallS).toFixed(2)} cores  keyframes ${stats.keyframes}` +
            `${stats.lateFrames ? `  late ${stats.lateFrames}` : ''}${stats.framesOut !== stats.framesIn ? `  frames ${stats.framesOut}/${stats.framesIn}` : ''}`);
    }
    if (crop) console.log(`  crops: ${saveCrops(input.label, input.ivfPath, outputs)}`);
    console.log('');
}

// ── Report ────────────────────────────────────────────────────

fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify({ env, configs, results }, null, 2));
const md = [
    `Chrome ${env.browser} · ${env.cpu} · pace=${pace}`,
    '',
    ...(displayFilter ? [`Shown = after \`${displayFilter}\``, ''] : []),
    '| input | config | MB | avg Mbps | peak 1s Mbps | SSIM | PSNR | shown SSIM | shown PSNR | latency p95 ms | max queue | CPU cores |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|',
    ...results.map((r) => `| ${r.input} | ${r.config} | ${(r.bytes / 1e6).toFixed(1)} | ${r.avgMbps.toFixed(2)} | ${r.peak1sMbps.toFixed(1)} | ${r.ssim.toFixed(4)} | ${r.psnr.toFixed(1)} | ` +
        `${r.displaySsim?.toFixed(4) ?? '–'} | ${r.displayPsnr?.toFixed(1) ?? '–'} | ${r.latencyMs?.p95.toFixed(0) ?? '–'} | ${r.maxEncodeQueue ?? '–'} | ${r.cpuCores.toFixed(2)} |`),
].join('\n');
fs.writeFileSync(path.join(outDir, 'results.md'), md + '\n');
console.log(`Results: ${path.join(outDir, 'results.md')}`);

await browser.close();
await browserServer.close();
server.close();
