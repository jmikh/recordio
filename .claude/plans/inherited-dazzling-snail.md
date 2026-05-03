# Switch Render Worker to FFmpeg NVENC Encoding

## Context

The render worker (Cloud Run, NVIDIA L4 GPU) currently encodes video via WebCodecs inside headless Chrome. Chrome on Linux cannot use NVENC for encoding (only VA-API, which NVIDIA proprietary drivers don't provide). This means the L4 GPU handles Vulkan rendering but encoding falls back to software — the bottleneck is ~400-500ms backpressure per 30 frames.

A `ServerExportPipeline` already exists (`render-worker/src/ServerExportPipeline.ts`) that:
- Decodes source video with FFmpeg (`ServerFrameExtractor`)
- Renders frames using `@napi-rs/canvas` (Skia-based, same engine as Chrome)
- Pipes raw RGBA frames to FFmpeg stdin for encoding
- Mixes audio with FFmpeg (`ServerAudioMixer`)

Currently it uses `-c:v libx264 -preset ultrafast`. We need to:
1. Wire it up as the active render path (currently unused — `server.ts` only calls `renderViaPlaywright`)
2. Switch the encoder to `h264_nvenc` with `libx264` fallback
3. Add upload logic (ServerExportPipeline produces a local file, Playwright uploads from browser)
4. Enable NVIDIA video driver capability in Docker

## Changes

### 1. Add `@napi-rs/canvas` dependency (`render-worker/package.json`)

Currently imported by `nodeRenderContext.ts` and `ServerFrameExtractor.ts` but not in package.json. Add it:

```json
"@napi-rs/canvas": "^0.1.65"
```

Also externalize it in `tsup.config.ts` since it's a native module:

```typescript
external: [
    'playwright',
    'fastify',
    '@napi-rs/canvas',
    // ...existing entries
],
```

### 2. Add NVENC codec detection + selection (`render-worker/src/ServerExportPipeline.ts`)

Before the FFmpeg encoder spawn (line 160), detect NVENC availability:

```typescript
async function detectNvenc(): Promise<boolean> {
    return new Promise((resolve) => {
        const proc = spawn('ffmpeg', ['-hide_banner', '-encoders'], { stdio: ['ignore', 'pipe', 'ignore'] });
        let output = '';
        proc.stdout!.on('data', (d: Buffer) => { output += d.toString(); });
        proc.on('close', () => { resolve(output.includes('h264_nvenc')); });
        proc.on('error', () => { resolve(false); });
    });
}
```

Replace the static `-c:v libx264` block with:

```typescript
const useNvenc = await detectNvenc();
console.log(`[Render] NVENC available: ${useNvenc}`);

if (useNvenc) {
    ffmpegArgs.push(
        '-c:v', 'h264_nvenc',
        '-preset', 'p4',       // medium quality/speed tradeoff
        '-rc', 'vbr',          // variable bitrate
        '-cq', '23',           // constant quality target
        '-pix_fmt', 'yuv420p',
    );
} else {
    ffmpegArgs.push(
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-crf', '23',
        '-pix_fmt', 'yuv420p',
    );
}
```

Also log the full FFmpeg command and whether NVENC is used in the timing output at the end.

### 3. Wire up ServerExportPipeline in `server.ts`

In `runRender()`, replace the `renderViaPlaywright()` call with `renderProject()` from ServerExportPipeline:

```typescript
import { renderProject } from './ServerExportPipeline.js';
```

After media download, call:

```typescript
const result = await renderProject({
    project: projectData as Project,
    projectName,
    quality: quality as ExportQuality,
    mediaDir: tmpDir,
    onProgress: (phase, progress, message) => {
        console.log(`[Render] [${phase}] ${(progress * 100).toFixed(1)}% — ${message}`);
        currentProgress = progress;
    },
});
```

Then upload the output file:

```typescript
const outputBuffer = fs.readFileSync(result.outputPath);
const uploadResp = await fetch(uploadUrl, {
    method: 'PUT',
    body: outputBuffer,
    headers: { 'Content-Type': 'video/mp4', 'x-upsert': 'true' },
});
if (!uploadResp.ok) throw new Error(`Upload failed: ${uploadResp.status}`);
```

Keep `renderViaPlaywright` as a fallback (env var `RENDER_MODE=playwright` to opt-in to old path).

### 4. Update Dockerfile

Add `video` to `NVIDIA_DRIVER_CAPABILITIES` so the container runtime mounts `libnvidia-encode.so`:

```dockerfile
ENV NVIDIA_DRIVER_CAPABILITIES=graphics,utility,compute,video
```

Add `LD_LIBRARY_PATH` to ensure FFmpeg finds NVIDIA encoding libs:

```dockerfile
ENV LD_LIBRARY_PATH=/usr/local/nvidia/lib64:${LD_LIBRARY_PATH}
```

### 5. Log NVENC diagnostics at startup (`server.ts`)

At server startup (near warmBrowser), probe FFmpeg for NVENC:

```typescript
try {
    const encoders = execSync('ffmpeg -hide_banner -encoders 2>/dev/null | grep nvenc', { timeout: 5000 }).toString().trim();
    console.log(`[Render] FFmpeg NVENC encoders: ${encoders}`);
} catch {
    console.log('[Render] FFmpeg NVENC: not available');
}
```

## Files to modify

| File | Change |
|------|--------|
| `render-worker/package.json` | Add `@napi-rs/canvas` dependency |
| `render-worker/tsup.config.ts` | Externalize `@napi-rs/canvas` |
| `render-worker/src/ServerExportPipeline.ts` | NVENC detection, codec selection with fallback |
| `render-worker/src/server.ts` | Wire up ServerExportPipeline, add upload, keep Playwright fallback |
| `render-worker/Dockerfile` | Add `video` driver capability, `LD_LIBRARY_PATH` |

## Scope: Server-only — local export unchanged

All changes are in `render-worker/`. The local/browser export path (`shared/export/ExportManager.ts` + WebCodecs) is **not touched**. The shared painters (`shared/painters/`) are read-only dependencies used by both paths — no modifications. Local export in the extension and webapp editor continues using WebCodecs exactly as it does today.

## Risks

1. **@napi-rs/canvas rendering differences**: Skia-based like Chrome, but edge cases (fonts, gradients, compositing) may differ. If visual quality doesn't match, we'd need the hybrid approach (Chrome rendering + FFmpeg encoding).
2. **NVENC libs missing**: If Ubuntu's `apt install ffmpeg` wasn't compiled with `--enable-nvenc`, or if `libnvidia-encode.so` isn't mounted, FFmpeg falls back to libx264 gracefully.
3. **@napi-rs/canvas native binary compatibility**: The builder stage (node:22-slim/Debian) vs production stage (Ubuntu 24.04/noble). Both are glibc-based amd64, so prebuilt binaries should work.

## Verification

1. Build: `docker buildx build --platform linux/amd64 -t ...render-worker:nvenc -f render-worker/Dockerfile --push .`
2. Deploy to Cloud Run with GPU
3. Check startup logs for: `[Render] FFmpeg NVENC encoders: h264_nvenc ...`
4. Trigger a render job
5. Check logs for: `[Render] NVENC available: true` and encoding speed improvement
6. Compare output quality vs Playwright path
