# Testing Strategy & Local Supabase Setup

## Context

Recordio is going enterprise but has almost zero tests (4 test files covering mappers only). All testing is manual against production. The architecture is:
- **Supabase** — auth, database (RPC functions), storage, edge functions (transcription, rendering orchestration, Stripe, Mux)
- **Render worker** — Cloud Run with GPU, stateless, no Supabase credentials (uses signed URLs + shared secret)
- **Webapp** — React SPA, cloud sync, project editing
- **Shared** — pure logic: mappers, animators, painters, export pipeline
- **Extension** — Chrome extension for recording

This plan establishes local Supabase, a layered testing strategy, and an incremental adoption path.

---

## Test File Organization

**Unit tests live next to their source files:**
```
shared/mappers/timeMapper.ts
shared/mappers/timeMapper.test.ts        ← co-located

webapp/src/core/migrateProject.ts
webapp/src/core/migrateProject.test.ts   ← co-located
```

**Integration/cross-cutting tests live in root `test/` directory:**
```
test/
  integration/
    supabase-rpc.test.ts          ← tests SQL functions against local Supabase
    edge-functions.test.ts        ← tests edge functions via HTTP
    render-worker.test.ts         ← tests render worker API
  fixtures/
    projects/                     ← project JSONs at each schema version
    media/                        ← small synthetic recordings
  helpers/
    createProject.ts              ← factory for test Project objects
    mockCrypto.ts                 ← deterministic UUID stub
    supabaseClient.ts             ← local Supabase test client
```

---

## Phase 1: Vitest Configuration

Root `package.json` already has `"test": "vitest"` and vitest v4.0.16.

### Create `vitest.config.ts` at repo root
Single config that picks up all `*.test.ts` files across `shared/`, `webapp/src/`, and `test/`:

```ts
export default defineConfig({
  test: {
    include: [
      'shared/**/*.test.ts',
      'webapp/src/**/*.test.ts',
      'test/**/*.test.ts',
    ],
    environment: 'node',
  },
})
```

### Add npm scripts to root `package.json`
```
"test": "vitest"
"test:ci": "vitest run --reporter=verbose"
```

**Files to create/modify:**
- `vitest.config.ts` (new)
- `package.json` (update test scripts)

---

## Phase 2: Test Helpers & Fixtures

### `test/helpers/createProject.ts`
Factory function that builds valid `Project` objects with sensible defaults and allows overrides. Critical for every test that needs project data.

### `test/fixtures/projects/`
Real (anonymized) project JSONs at each schema version for migration testing:
- `minimal-v5.json` — screen only, no camera, no effects
- `full-v5.json` — all sources, zoom/spotlight/caption segments, overlays
- `legacy-v1.json` — pre-migration project shape
- `legacy-v3.json` — mid-migration (has text captions, old background URLs)

### `test/fixtures/media/`
Small synthetic recordings (2-3 seconds each), generated via ffmpeg:
```bash
ffmpeg -f lavfi -i color=c=blue:s=1920x1080:d=3 -c:v libvpx -f webm test-screen.webm
ffmpeg -f lavfi -i color=c=green:s=640x480:d=3 -c:v libvpx -f webm test-camera.webm
ffmpeg -f lavfi -i sine=frequency=440:duration=3 test-mic.wav
```

### `test/helpers/mockCrypto.ts`
Deterministic `crypto.randomUUID()` stub for tests that hit `textToWords` or project creation.

### `test/helpers/supabaseClient.ts`
Helper that creates a Supabase client pointed at local instance (`http://localhost:54321`) with the local service-role key. Used by integration tests.

**Files to create:**
- `test/helpers/createProject.ts`
- `test/helpers/mockCrypto.ts`
- `test/helpers/supabaseClient.ts`
- `test/fixtures/projects/*.json` (4 files)
- `test/fixtures/media/` (3 files, generated)

---

## Phase 3: Pure Unit Tests (co-located with source)

Highest ROI: zero infrastructure, fast, deterministic. Protects the core logic that produces correct videos.

### 3a. TimeMapper — expand from 3 → 50+ cases
**File:** `shared/mappers/timeMapper.test.ts` (existing, extend)

Add test groups:
- **Speed variations**: 2x, 0.5x, mixed speeds across windows, speed=0 edge case
- **mapSourceToOutputTime boundaries**: exact window start/end, in gap, before first window, after last window, negative input
- **mapOutputToSourceTime boundaries**: time=0, exact duration, past duration, negative
- **mapSourceRangeToOutputRange**: span 3+ windows, zero-length range, entire timeline, range with speed≠1
- **getWindowAtOutputTime**: boundary between windows, time=0, empty windows
- **getOutputDuration**: single window, multiple windows, windows with different speeds

### 3b. ViewMapper — expand from 14 → 30+ cases
**File:** `shared/mappers/viewMapper.test.ts` (existing, extend)

Add: edge cases for extreme aspect ratios, zero-size inputs, device frame with crop, letterboxing calculations.

### 3c. New test files (co-located next to source)

| Source file | Test file (co-located) | Cases | Priority |
|------------|------------------------|-------|----------|
| `shared/animators/zoomAnimator.ts` | `shared/animators/zoomAnimator.test.ts` | 10+ | HIGH |
| `shared/animators/spotlightAnimator.ts` | `shared/animators/spotlightAnimator.test.ts` | 8+ | MEDIUM |
| `shared/animators/cameraAnimator.ts` | `shared/animators/cameraAnimator.test.ts` | 8+ | MEDIUM |
| `shared/animators/easing.ts` | `shared/animators/easing.test.ts` | 8+ | MEDIUM |
| `webapp/src/core/migrateProject.ts` | `webapp/src/core/migrateProject.test.ts` | 15+ | HIGH |

### 3d. Migration tests detail
Use fixture-driven approach: load JSON from `test/fixtures/projects/legacy-v1.json`, run `migrateProject()`, assert output matches expected v5 shape. Key cases:
- v1→v2: `cameraLayoutSegments` renamed to `cameraMoveSegments`
- v2→v3: `captionSegments[].text` → generates `words[]` via `textToWords`
- v3→v4: relative background URLs → CDN URLs
- Full chain: v1 all the way to v5
- Already-current: v5 input → no changes except version stamp
- Missing optional fields → backfilled with defaults

---

## Phase 4: Webapp Logic Tests (co-located, mock Supabase client)

### 4a. CloudProjectService
**File:** `webapp/src/storage/cloudProjectService.test.ts`

Mock at module boundary: `vi.mock('./cloudStorage')`, `vi.mock('./blobCache')`, mock zustand stores.

Cases:
- Save project → CloudStorage.upsert called with correct data
- Save same project twice → second save skipped (hash match, no-op)
- Save with stale cloud version → conflict error propagated
- Concurrent save guard → second save returns immediately
- Load project → migrateProject runs on result

### 4b. Project factory
**File:** `webapp/src/core/Project.test.ts`

Test `createDefaultProject` and related factories produce valid, complete project objects.

---

## Phase 5: Local Supabase Setup

### 5a. Initialize local Supabase
```bash
npx supabase init  # creates supabase/config.toml (if missing)
npx supabase start # starts Postgres, Auth, Storage, Edge Functions in Docker
```

The existing migration files in `supabase/migrations/` auto-apply, giving a fully-schema'd local database matching production.

### 5b. Create seed file
**File:** `supabase/seed.sql` (new)

Insert test data:
- 2 test users (via `auth.users` — local Supabase allows direct inserts)
- Subscriptions: one active pro, one trialing
- 3-4 projects with real `project_data` JSONB (captured from production, anonymized)
- `user_quotas`, `transcription_usage`, `user_profiles` rows

### 5c. Environment config
**File:** `.env.test` (new) — points to local Supabase:
```
VITE_SUPABASE_URL=http://localhost:54321
VITE_SUPABASE_ANON_KEY=<local-anon-key-from-supabase-start>
```

---

## Phase 6: Integration Tests (root `test/` directory)

These run against local Supabase and/or the render worker. Require `supabase start`.

### 6a. Supabase RPC tests
**File:** `test/integration/supabase-rpc.test.ts`

Test the SQL functions that contain critical business logic, using the local Supabase client:

| RPC function | What to test |
|-------------|-------------|
| `project_update()` | Optimistic concurrency — version bump on change, skip on identical data (MD5), reject stale version |
| `render_job_get_or_create()` | Cache hit (completed job returns path), dedup (pending job returns existing), retry (failed → pending), new job creation |
| `mux_video_get_or_create()` | Same dedup/cache/retry pattern |
| `render_job_complete()` | Status transition, cascade failure to mux_videos |
| `set_project_expiry()` | Cascade expiry across all user projects |
| `subscription_get()` | Returns correct subscription shape |

### 6b. Edge function tests
**File:** `test/integration/edge-functions.test.ts`

Test edge functions via HTTP against locally-served functions (`supabase functions serve`):

| Edge function | What to test |
|--------------|-------------|
| `transcribe` | Rate limiting cycle reset logic (monthly, yearly, trial), usage tracking, 429 when exceeded |
| `project-create` | Storage path generation, signed URL return, expiry logic (free vs pro) |
| `render-job-create` | Dedup behavior, signed URL generation, pro access check |
| `stripe-webhooks` | Subscription state transitions (checkout → active, cancel → expiry cascade) |
| `asset-create` | Validation (size limits, type checks, library limit of 10) |

Mock external APIs (OpenAI, Stripe, Mux) at the fetch level or via env var overrides.

### 6c. Render worker API tests
**File:** `test/integration/render-worker.test.ts`

Start render worker locally (without GPU — it falls back to software rendering), test the HTTP API:

- `POST /render` with valid secret → 200 + `{ ok: true, jobId }`
- `POST /render` with bad secret → 401
- Media serving: downloaded files accessible via `GET /{jobId}/{filename}`
- Progress callback: verify heartbeat POSTs are sent to statusCallbackUrl (use a mock HTTP server)
- Result: verify output file is PUT to uploadUrl (mock endpoint)

Note: actual rendering needs a browser with WebCodecs. For CI, test the API contract only; for local smoke tests, let it render a 3-second test project.

---

## Phase 7: Playwright (Future, Last Resort)

**Not in initial implementation.** Add later only for flows that can't be tested any other way:

1. **Export flow smoke test** — Open editor with test project, trigger export, verify blob is produced (exercises WebCodecs which don't exist in Node)
2. **Auth flow** — Only if auth regressions recur

---

## Implementation Order

| Step | What | Effort | Impact |
|------|------|--------|--------|
| 1 | Vitest config (Phase 1) | 30 min | Enables everything |
| 2 | Test helpers + fixtures (Phase 2) | 1-2 hr | Reused everywhere |
| 3 | TimeMapper 50+ tests (Phase 3a) | 2-3 hr | Protects core video timing |
| 4 | migrateProject 15+ tests (Phase 3d) | 2 hr | Protects data integrity |
| 5 | Animator tests (Phase 3c) | 2-3 hr | Protects visual effects |
| 6 | CloudProjectService tests (Phase 4a) | 2-3 hr | Protects cloud sync |
| 7 | Local Supabase setup (Phase 5) | 2-3 hr | Enables integration tests |
| 8 | Supabase RPC tests (Phase 6a) | 2-3 hr | Protects DB business logic |
| 9 | Edge function tests (Phase 6b) | 3-4 hr | Protects API layer (transcription rate limits, render orchestration) |
| 10 | Render worker API tests (Phase 6c) | 2-3 hr | Protects render pipeline |

Steps 1-6 give the most reliability for the least effort (pure logic, no infrastructure). Steps 7-10 add the database and service layer.

---

## Verification

```bash
npm test              # all tests in watch mode
npm run test:ci       # single run, verbose output
```

Pure unit tests (Phases 3-4) pass with zero infrastructure.
Integration tests (Phase 6) require `supabase start` running locally.
Render worker tests (Phase 6c) require the render worker running locally.
