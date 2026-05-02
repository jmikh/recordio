# Add Export Encoder Diagnostics

## Context

The render worker (Cloud Run, NVIDIA L4 GPU) shows high backpressure (~400-500ms per 30 frames) during export. Hardware VP9 **decode** is confirmed working, but we don't know if the **encoder** is using hardware (NVENC) or falling back to software. The `/dev/dri/renderD128` creation fails in the logs, which may prevent Chrome from using NVENC. Additionally, decode cost varies dramatically during the export (444ms early → 139ms later), and we want to understand why.

## Changes

### 1. Log encoder codec selection (`shared/export/ExportManager.ts`)

After `resolveVideoCodec()` at line 135, log the selected codec, whether it's a fallback, and what was tried:

```typescript
console.log(`[Export] Video codec: ${videoCodec.muxerCodec} (${videoCodec.config.codec}), ` +
    `fallback=${videoCodec.fallback}, tried=[${videoCodec.tried.join(', ')}], ` + 
    `${width}x${height} @ ${videoCodec.config.bitrate! / 1_000_000}Mbps`);
```

### 2. Log encoder hardware acceleration (`shared/export/codecResolver.ts`)

In `resolveVideoCodec()`, after a codec is confirmed supported (line 51), also probe with `hardwareAcceleration: 'prefer-hardware'` and log the result. This tells us if NVENC is available:

```typescript
// After finding a supported codec, check if hardware acceleration is available
const hwConfig = { ...config, hardwareAcceleration: 'prefer-hardware' as const };
const hwResult = await VideoEncoder.isConfigSupported(hwConfig);
console.log(`[Export] Encoder HW accel for ${codec}: ${hwResult.supported}`);
// If hardware supported, use it
if (hwResult.supported) {
    return { config: hwConfig, muxerCodec: 'avc', fallback: false, tried };
}
```

Do the same for the VP9 fallback path.

### 3. Log per-batch decode detail (`shared/export/ExportManager.ts`)

In the existing 150-frame timing log (line 387), add chunks-fed count to understand the early vs. late decode cost difference. Track total chunks fed per batch in the frame loop:

```typescript
// Add accumulator alongside existing ones (line 288)
let accChunksFed = 0;

// After decode (line 318), sum chunks fed
// Need FrameExtractor to expose this — see #4
```

### 4. Expose chunks-fed counter from FrameExtractor (`shared/export/FrameExtractor.ts`)

Add a `lastChunksFed` property that `getFrameAtTime` sets after each call (the `fed` variable at line 399). ExportManager can read this after each decode to accumulate for logging:

```typescript
// New public property
public lastChunksFed = 0;

// In getFrameAtTime, before return (around line 527):
this.lastChunksFed = fed;
```

### 5. Log encoder queue depth in timing breakdown (`shared/export/ExportManager.ts`)

Add max encoder queue size per batch to the timing log to understand backpressure patterns:

```typescript
// Add accumulator (line 288)
let maxQueueSize = 0;

// Before backpressure wait (line 369)
maxQueueSize = Math.max(maxQueueSize, videoEncoder.encodeQueueSize);

// In the log (line 387), append:
// `maxQueue=${maxQueueSize}`
```

## Files to modify

| File | Change |
|------|--------|
| `shared/export/ExportManager.ts` | Log codec selection, chunks-fed per batch, max queue depth |
| `shared/export/codecResolver.ts` | Probe + log hardware acceleration, prefer hardware if available |
| `shared/export/FrameExtractor.ts` | Expose `lastChunksFed` property |

## Why decode is expensive early, cheap later

Most likely: the export doesn't start at frame 0 of the source video — or the `FEED_AHEAD_MS = 2000` margin causes the first few calls to feed large bursts of chunks from the nearest keyframe. Once the decoder is caught up and in steady-state, each call only feeds 1-2 new chunks. The `lastChunksFed` log will confirm this.

## Verification

Deploy to Cloud Run, trigger a render, check logs for:
- `[Export] Video codec: avc (avc1.64002a) ... ` — confirms which codec
- `[Export] Encoder HW accel for avc1.64002a: true/false` — confirms NVENC
- Chunks-fed counts in per-batch logs — explains decode cost variance
- Max queue depth — shows how saturated the encoder is
