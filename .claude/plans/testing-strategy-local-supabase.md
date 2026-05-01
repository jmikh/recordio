# Testing Strategy & Local Supabase Setup

## Context

Recordio is going enterprise but has almost zero tests (4 test files covering mappers only). All testing is manual against production, which is risky — regressions like broken transcription slip through. This plan establishes:
1. A local Supabase environment with realistic test data
2. A layered testing strategy (unit → integration → e2e) that's mostly programmatic and deterministic
3. An incremental adoption path starting with the highest-ROI tests

---

## Phase 1: Vitest Configuration (Foundation)

Currently there's no vitest config. The root `package.json` already has `"test": "vitest"` and vitest v4.0.16 installed.

### Create `vitest.workspace.ts` at repo root
Define 2 workspace projects so `vitest` runs everything with one command:

| Project | Environment | Scope |
|---------|------------|-------|
| `shared` | `node` | Pure logic: mappers, animators, utils, export helpers |
| `webapp` | `node` | Cloud sync, project model, migrations (mock Supabase client) |

### Create per-workspace vitest configs
- `shared/vitest.config.ts` — `include: ['**/*.test.ts']`
- `webapp/vitest.config.ts` — `include: ['src/**/*.test.ts']`

### Add npm scripts to root `package.json`
```
"test:unit": "vitest --project shared"
"test:webapp": "vitest --project webapp"
"test:ci": "vitest run --reporter=verbose"
```

**Files to create/modify:**
- `vitest.workspace.ts` (new)
- `shared/vitest.config.ts` (new)
- `webapp/vitest.config.ts` (new)
- `package.json` (add scripts)

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

**Files to create:**
- `test/helpers/createProject.ts`
- `test/helpers/mockCrypto.ts`
- `test/fixtures/projects/*.json` (4 files)
- `test/fixtures/media/` (3 files, generated)

---

## Phase 3: Tier 1 — Pure Unit Tests (shared/)

These are the highest ROI: zero infrastructure, fast, deterministic, and they protect the core logic that produces correct videos.

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

### 3c. New test files for untested pure modules

| File to test | Test file | Cases | Priority |
|-------------|-----------|-------|----------|
| `shared/animators/zoomAnimator.ts` | `zoomAnimator.test.ts` | 10+ (gap interpolation, easing, partial gaps) | HIGH |
| `shared/animators/spotlightAnimator.ts` | `spotlightAnimator.test.ts` | 8+ | MEDIUM |
| `shared/animators/cameraAnimator.ts` | `cameraAnimator.test.ts` | 8+ | MEDIUM |
| `shared/animators/easing.ts` | `easing.test.ts` | 8+ (monotonicity, bounds) | MEDIUM |
| `webapp/src/core/migrateProject.ts` | `migrateProject.test.ts` | 15+ (full chain v1→v5, each step, idempotency) | HIGH |

### 3d. Migration tests detail
Use fixture-driven approach: load JSON from `test/fixtures/projects/legacy-v1.json`, run `migrateProject()`, assert output matches expected schema v5 shape. Key cases:
- v1→v2: `cameraLayoutSegments` renamed to `cameraMoveSegments`
- v2→v3: `captionSegments[].text` → generates `words[]` via `textToWords`
- v3→v4: relative background URLs → CDN URLs
- Full chain: v1 all the way to v5
- Already-current: v5 input → no changes except version stamp
- Missing optional fields → backfilled with defaults

---

## Phase 4: Tier 2 — Backend Integration Tests

### 4a. Rate limit pure logic (no Supabase needed)
**File:** `backend/src/transcription/rateLimit.test.ts` (new)

`computeCycleResetDate` is already exported and pure — takes an `AuthenticatedUser`, returns a `Date`. Use `vi.useFakeTimers()` to control "now".

Cases:
- Trialing → returns `currentPeriodEnd`
- Monthly → returns `currentPeriodEnd`
- Yearly, anniversary day in future this month → this month's date
- Yearly, anniversary day already passed → next month
- Yearly, anniversary day = today → next month
- Yearly, day=31 and next month has 30 days → Date overflow handling
- Yearly, computed reset > `currentPeriodEnd` → clamps

### 4b. Backend route tests (Fastify injection + mocked deps)
**File:** `backend/src/transcription/route.test.ts` (new)

Use Fastify's `app.inject()` for HTTP-level tests without starting a server. Mock:
- Supabase client (vi.mock the auth middleware module)
- OpenAI API (vi.mock openai)

Test cases:
- Valid request → 200 + transcription segments returned
- Missing auth → 401
- Rate limit exceeded → 429 with usage info
- OpenAI failure → 500 + usage rolled back
- Invalid audio format → 400

---

## Phase 5: Tier 3 — Webapp Logic Tests (mock Supabase client)

### 5a. CloudProjectService
**File:** `webapp/src/storage/cloudProjectService.test.ts` (new)

Mock at module boundary: `vi.mock('./cloudStorage')`, `vi.mock('./blobCache')`, mock zustand stores.

Cases:
- Save project → CloudStorage.upsert called with correct data
- Save same project twice → second save skipped (hash match, no-op)
- Save with stale cloud version → conflict error propagated
- Concurrent save guard → second save returns immediately
- Load project → migrateProject runs on result

### 5b. Project factory
**File:** `webapp/src/core/Project.test.ts` (new)

Test `createDefaultProject` and related factories produce valid, complete project objects.

---

## Phase 6: Local Supabase Setup

### 6a. Initialize local Supabase
```bash
cd webapp
npx supabase init  # creates supabase/config.toml
npx supabase start # starts Postgres, Auth, Storage, Edge Functions in Docker
```

The 31 existing migration files in `webapp/supabase/migrations/` will auto-apply. This gives you a fully-schema'd local database matching production.

### 6b. Create seed file
**File:** `webapp/supabase/seed.sql` (new)

Insert test data:
- 2 test users (via `auth.users` — local Supabase allows direct inserts)
- Subscriptions: one active pro, one trialing
- 3-4 projects with real `project_data` JSONB (captured from production, anonymized)
- `user_quotas` rows
- `transcription_usage` rows

### 6c. Seed storage bucket
**File:** `test/helpers/seedStorage.ts` (new)

Script that uses local Supabase service-role key to:
1. Create `project-media` bucket
2. Upload test media files to expected storage paths

### 6d. Environment config
**File:** `webapp/.env.local.test` (new) — points to local Supabase:
```
VITE_SUPABASE_URL=http://localhost:54321
VITE_SUPABASE_ANON_KEY=<local-anon-key-from-supabase-start>
```

### 6e. Integration tests against local Supabase
Once local Supabase is running, write integration tests that exercise the real database:
- Edge function tests via `fetch('http://localhost:54321/functions/v1/...')`
- RPC tests (project_update, subscription_get, upsert_transcription_usage)
- Storage signed URL generation + upload/download

These are **optional stretch goals** — the unit tests in Phases 3-5 give 80%+ of the reliability win. Local Supabase integration tests add the remaining 20%.

---

## Phase 7: Playwright (Last Resort, Future)

**Not in initial implementation.** Start with zero Playwright tests. Add later only for flows that can't be tested any other way:

1. **Export flow smoke test** — Open editor with test project, trigger export, verify blob is produced. This is the best Playwright candidate since it exercises WebCodecs which don't exist in Node.
2. **Auth flow** — Only if auth regressions become a recurring issue.

When ready:
- `npx playwright init` at root
- Single `tests/export-smoke.spec.ts` that loads a project and exports
- Run against `npm run dev:webapp` with local Supabase

---

## Implementation Order (Start Here)

| Step | What | Effort | Impact |
|------|------|--------|--------|
| 1 | Vitest workspace config (Phase 1) | 30 min | Enables everything |
| 2 | Test helpers + fixtures (Phase 2) | 1-2 hr | Reused everywhere |
| 3 | TimeMapper 50+ tests (Phase 3a) | 2-3 hr | Protects core video timing |
| 4 | migrateProject 15+ tests (Phase 3d) | 2 hr | Protects data integrity |
| 5 | computeCycleResetDate tests (Phase 4a) | 1 hr | Protects billing logic |
| 6 | Animator tests (Phase 3c) | 2-3 hr | Protects visual effects |
| 7 | CloudProjectService tests (Phase 5a) | 2-3 hr | Protects cloud sync |
| 8 | Local Supabase setup (Phase 6) | 2-3 hr | Enables DB integration tests |
| 9 | Backend route tests (Phase 4b) | 2-3 hr | Protects API reliability |

Steps 1-5 give you the most reliability for the least effort. Steps 6-9 add the database layer.

---

## Verification

After implementation, verify by running:
```bash
npm test              # all tests in watch mode
npm run test:ci       # single run, verbose output  
npm run test:unit     # shared/ only (should be <2s)
npm run test:backend  # backend/ only
npm run test:webapp   # webapp/ only
```

All pure unit tests (Phase 3) should pass with zero infrastructure. Backend/webapp tests should pass with mocked dependencies. Local Supabase integration tests (Phase 6e) require `supabase start` running.
