---
name: captions
description: Captions & transcription system — local Whisper worker, OpenAI cloud API, caption rendering, word editing, rate limiting, and data model.
when_to_use: When modifying transcription logic, caption rendering, word editing, caption settings UI, cloud transcription backend, rate limiting, or anything touching captionSegments/Word types.
---

# Captions & Transcription

## Architecture Overview

Two transcription engines produce the same output type (`CaptionSegment[]`):

```
Local (free):   CaptionsSettings → TranscriptionService → Web Worker (Whisper) → CaptionSegment[]
Cloud (pro):    CaptionsSettings → CloudTranscriptionService → Backend /transcribe → OpenAI API → CaptionSegment[]
```

Both paths end with `setCaptionSegments()` which stamps output times and persists to `project.timeline.captionSegments`.

---

## File Map

### Frontend (`webapp/src/`)

| File | Role |
|---|---|
| `core/transcription/TranscriptionService.ts` | Local engine — decodes audio to 16kHz Float32, sends to worker, returns `CaptionSegment[]` |
| `core/transcription/transcription.worker.ts` | Web Worker — loads HuggingFace Whisper model, runs inference |
| `core/transcription/CloudTranscriptionService.ts` | Cloud engine — sends audio to backend, maps response to `CaptionSegment[]` |
| `core/captionUtils.ts` | `textToWords()` — splits text into `Word[]` with proportional timestamps; `getSegmentText()` — derives display text from words |
| `core/painters/captionPainter.ts` | Canvas rendering — word wrapping, highlight, background box |
| `editor/stores/slices/transcriptionSlice.ts` | Zustand slice — CRUD for captions, transcription progress state |
| `editor/components/settings/CaptionsSettings.tsx` | UI — engine toggle, generate button, word editing popover, style controls |
| `types/timeline.ts` | `Word`, `CaptionSegment` interfaces (both extend `TimeSegment`) |
| `types/settings.ts` | `CaptionSettings` interface |

### Backend (`backend/src/transcription/`)

| File | Role |
|---|---|
| `route.ts` | `POST /transcribe` — auth, rate limit, call OpenAI, return segments |
| `openai.ts` | `transcribeAudio()` — calls OpenAI Whisper API, restores punctuation to words |
| `rateLimit.ts` | `checkAndReserve()` / `rollback()` — atomic monthly usage tracking via Supabase RPC |
| `types.ts` | `TranscribeSegment`, `TranscribeWord`, `TranscribeResponse`, `RateLimitError` |

### Database

| File | Role |
|---|---|
| `webapp/supabase/migrations/20260417170000_per_user_transcription_limit.sql` | `transcription_usage` table, `upsert_transcription_usage()` RPC |

---

## Data Model

### CaptionSegment & Word

Both extend `TimeSegment` (see project-model skill). Text is **never stored separately** — always derived from `words[]`.

```
CaptionSegment (extends TimeSegment)
  words: Word[]

Word (extends TimeSegment)
  word: string          — the actual text
  hidden?: boolean      — user can hide words (still stored, filtered during render)
```

### CaptionSettings (in `project.settings.captions`)

```
enabled: boolean              — master render toggle
captionSize: number           — 0.5-2.0 multiplier (reference: 50px at 1080p)
width: number                 — 30-100, percentage of canvas width
textColor: string             — hex (#rrggbb)
backgroundColor: string       — hex with alpha (#rrggbbaa)
wordHighlight: boolean        — karaoke-style progressive word highlighting
transcriptionSource?: {       — which engine produced the current captions
  engine: 'local' | 'openai'
  language: string
}
```

### Store State (TranscriptionSlice)

```
isTranscribing: boolean
transcriptionPhase: 'idle' | 'downloading' | 'generating'
modelDownloadProgress: number    — 0-1, only during local model download
transcriptionProgress: number
transcriptionError: string | null
```

These live in `useProjectStore` (not `useUIStore`) so they persist across panel switches.

---

## Local Transcription

### Worker (`transcription.worker.ts`)

- Model: `Xenova/whisper-small.en` (~460MB, English only)
- Uses HuggingFace Transformers.js `pipeline('automatic-speech-recognition', ...)`
- Model cached in browser Cache Storage (clear via DevTools > Application > Cache Storage)

**Message protocol (main thread <-> worker):**

| To Worker | From Worker |
|---|---|
| `{ type: 'transcribe', audioBuffer }` | `{ type: 'model_loading' }` |
| `{ type: 'abort' }` | `{ type: 'model_progress', progress: 0-1 }` |
| | `{ type: 'progress', progress: 0-1 }` |
| | `{ type: 'result', chunks: [...] }` |
| | `{ type: 'error', error: string }` |

**Gotchas:**

1. **`@ts-ignore` required** — Transformers.js `pipeline()` has a union type too complex for TS. Keep the `@ts-ignore` comment.
2. **Model download progress aggregation** — HuggingFace reports per-file progress. Worker aggregates loaded/total bytes across all files via a `Map` to produce a single 0-1 value. Without this, the progress bar jumps backwards as new files start downloading.
3. **Fake transcription progress** — No real progress from Whisper inference. Worker estimates based on audio duration (1s real-time per 10s audio) and ticks linearly from 0.3 to 0.95.
4. **No language parameter** — Local model is English-only. Language dropdown was removed.

### TranscriptionService

- Singleton (`getInstance()`)
- `decodeAudio()` converts any audio/video blob to 16kHz mono Float32Array via `AudioContext`
- `onPhaseChange` callback reports `'downloading'` vs `'generating'` phases to the store

---

## Cloud Transcription

### Frontend (`CloudTranscriptionService.ts`)

- Requires auth (`AuthManager.getSession()`) and pro access
- Estimates audio duration client-side via `AudioContext.decodeAudioData()` for rate limit pre-check
- Sends `FormData` with `audio` blob, `language`, `durationSeconds` to `POST /transcribe`
- Maps response segments to `CaptionSegment[]`, generating `id` and zeroed output times (stamped later by `setCaptionSegments`)

### Backend Route (`POST /transcribe`)

Request: multipart/form-data with `Authorization: Bearer {token}`
- `audio`: blob (max 500MB)
- `language`: ISO 639-1 code or `'auto'`
- `durationSeconds`: float

Response 200: `{ segments, minutesUsed, cycleMinutesUsed, cycleMinutesLimit, cycleResetsAt }`
Response 429: `{ error: 'rate_limit_exceeded', cycleMinutesUsed, cycleMinutesLimit, resetsAt }`

### OpenAI Integration (`openai.ts`)

- Uses `whisper-1` model with `timestamp_granularities: ['segment', 'word']`
- Prompt: `'Remove filler words such as um, uh, like, you know. Use proper punctuation and capitalization.'`

**Gotchas:**

1. **Language 'auto'** — OpenAI doesn't accept `'auto'` as a language value. It auto-detects when the `language` field is **omitted**. Backend uses `...(language !== 'auto' && { language })`.
2. **Punctuation on words** — OpenAI returns punctuation in `segments[].text` but strips it from `words[].word`. The `addPunctuationFromSegments()` function walks segment texts and attaches trailing punctuation back to words via token matching.
3. **Segment grouping** — Words are grouped into segments using Whisper's own segment boundaries (natural sentences), not arbitrary time windows.

### Rate Limiting (`rateLimit.ts`)

- Per-user monthly minutes limit (configurable per user, default from config)
- Minutes granularity: `Math.ceil(durationSeconds / 6) / 10` (nearest 0.1 min)
- Atomic check-and-reserve via Supabase RPC (`upsert_transcription_usage`)
- On OpenAI failure: automatic rollback of reserved minutes
- Cycle reset logic:
  - Monthly plans: Stripe's `current_period_end`
  - Yearly plans: monthly windows from subscription anniversary day
  - Trialing: end of trial period
- Frontend handles 429 with `RateLimitError` class — shows toast with usage and reset date

---

## Caption Rendering (`captionPainter.ts`)

Called by `PlaybackRenderer` on every frame:

```
drawCaptions(ctx, captionSegments, settings, currentTimeMs, outputSize)
```

- Filters to `visible` segments whose output time range contains `currentTimeMs`
- Scales all dimensions from 1080p reference (font 50px, padding 32x16, radius 12)
- Hidden words (`word.hidden`) are filtered out during rendering
- Word highlighting: words at `globalIndex <= highlightUpToIndex` get opacity 1.0, rest get 0.6
  - `highlightUpToIndex` = last word where `currentTimeMs >= word.outputStartTimeMs`
- Custom word-wrapping algorithm preserves word indices for per-word highlighting
- Background: rounded rect with hex+alpha color, 1px white/10% border
- Font: `600 {size}px Satoshi, ...system fonts`
- Multiple captions stack vertically (bottom-up) with spacing

---

## UI (`CaptionsSettings.tsx`)

### Engine Selection & Generation

- `MultiToggle` switches between `'local'` and `'openai'` (OpenAI has ProBadge)
- OpenAI gated: unauthenticated -> AuthModal, no pro -> UpgradeModal
- Button states:
  - `isTranscribing` + downloading -> "Downloading Model..." with spinner + progress bar
  - `isTranscribing` + generating -> "Generating..." with spinner
  - Generated with 0 results -> "No Speech Detected" (disabled)
  - Generated with results -> "Captions Generated" (disabled)
  - Different engine selected -> "Re-generate Captions" (enabled)
  - Never generated -> "Generate Captions"

### Word Editing (popover)

- Click a word -> popover appears above it (portal on `document.body`)
- Click another word in same segment -> selects range
- Click same word again -> deselects
- Click the time label -> selects all visible words in the segment
- Popover actions: Edit (pencil, single word only), Hide, Show
- Edit mode: inline text input + Save button
- **Popover uses `onClick stopPropagation`** to prevent the document-level click-outside handler from closing it during edit interactions

### Post-Generation

- On success with captions: success toast, auto-expand Captions collapsible, scroll into view
- On success with 0 captions: error toast with engine-specific message (local suggests trying OpenAI)
- On rate limit: error toast with usage and reset date

### Style Controls

- Only visible when captions exist
- Word Highlight toggle, Size slider (0.5-2x), Width slider (30-100%), Text color, Background color (with alpha)

---

## Output Time Recomputation

Caption output times are recomputed in two places:

1. **TranscriptionSlice** — `setCaptionSegments()`, `updateCaptionSegment()`, `addCaptionSegment()` all call `recomputeCaptionOutputTimes()`
2. **WindowSlice** — when output windows change (cut, speed, split), all segment types including captions are recomputed

The helper `recomputeCaptionOutputTimes()` is defined in both `transcriptionSlice.ts` and `windowSlice.ts` (same logic) — it calls `recomputeOutputTimes()` on segments AND their nested words.

---

## Migration (v2 -> v3)

In `migrateProject.ts`, captions migrated from text-based to word-based format:

- **Case 1:** Already has `words[].sourceStartTimeMs` -> just delete `text` field
- **Case 2:** Has old field names (`sourceStartMs`) -> rename fields, add `id`
- **Case 3:** Only has `text` -> generate words via `textToWords()` (proportional timestamps)

Also removes legacy `baselineCaptions` field from settings.

---

## Analytics

`trackCaptionsGenerated()` fires on successful generation:
```
{ segment_count, is_authenticated, is_pro, transcription_method: 'local' | 'cloud' }
```
