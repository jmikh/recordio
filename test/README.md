# Testing

## Test categories

| Category | Files | Infrastructure needed |
|---|---|---|
| **Unit tests** | `shared/**/*.test.ts`, `webapp/src/**/*.test.ts` | None |
| **Supabase RPC tests** | `test/integration/supabase-rpc.test.ts` | Supabase |
| **Edge function tests** | `test/integration/edge-functions.test.ts` | Supabase + Functions + MinIO + Mock render worker |
| **Render worker tests** | `test/integration/render-worker.test.ts` | Supabase + Functions + MinIO + Playwright + ffmpeg |

## Prerequisites

- [Supabase CLI](https://supabase.com/docs/guides/cli)
- [Docker](https://www.docker.com/) (for MinIO and Supabase)
- [ffmpeg](https://ffmpeg.org/) (for render worker tests — generates test media)
- Playwright Chromium: `npx playwright install chromium`

## Running unit tests (no setup needed)

```bash
npx vitest run shared/ webapp/src/
```

These tests have zero external dependencies.

## Local infrastructure setup

### 1. Start Supabase

```bash
supabase start
```

This starts the local Supabase stack (Postgres, Auth, Storage, etc.) and seeds the database with test users and projects from `supabase/seed.sql`.

### 2. Start MinIO (local S3)

```bash
docker compose up -d minio
```

Then create the required bucket:

```bash
npx tsx test/helpers/setupMinio.ts
```

MinIO console is available at http://127.0.0.1:9001 (login: `minioadmin` / `minioadmin`).

### 3. Serve edge functions

```bash
supabase functions serve --env-file supabase/.env.local
```

This must stay running in a separate terminal. The `--env-file` flag loads S3 credentials, render worker URL, Mux mock config, etc.

## Running integration tests

### Supabase RPC tests

**Requires:** Supabase

```bash
npx vitest run test/integration/supabase-rpc.test.ts
```

Tests database RPC functions (project CRUD, render jobs, etc.) using real Supabase clients authenticated as test users.

### Edge function tests

**Requires:** Supabase + edge functions + MinIO

```bash
npx vitest run test/integration/edge-functions.test.ts
```

Tests edge functions (`storage-download-urls`, `render-job-create`, etc.) via HTTP. The mock render worker is started/stopped automatically by the test (no manual setup needed).

### Render worker tests

**Requires:** Supabase + edge functions + MinIO + ffmpeg + Playwright

```bash
npx vitest run test/integration/render-worker.test.ts
```

This is a zero-mock integration test. It starts the real Fastify render server, downloads real media from MinIO, renders via real Playwright, uploads results back to MinIO, and verifies status callbacks through real Supabase edge functions.

First run will be slow (~60s) due to Playwright browser launch and ffmpeg media generation. Subsequent runs reuse cached media.

## Running everything

```bash
# Start all infrastructure first (see steps 1-3 above), then:
npx vitest run
```

## Local rendering from the UI

If you want to trigger a real render from the webapp (click Export), start the render worker on port 8090 (the port edge functions are configured to call):

```bash
PORT=8090 npx tsx render-worker/src/server.ts
```

This uses the same port as the mock render worker used by tests. They won't conflict — the mock only lives for the few seconds a test runs. Just don't run edge function tests while the real worker is up.

**Requires:** MinIO running + Supabase with functions served (same as integration tests).

## Quick reference: all local servers

| Service | Port | How to start |
|---|---|---|
| Supabase (Postgres, Auth, API) | 54321 | `supabase start` |
| Supabase Studio | 54323 | Started with `supabase start` |
| Edge functions | 54321 (via gateway) | `supabase functions serve --env-file supabase/.env.local` |
| MinIO S3 API | 9000 | `docker compose up -d minio` |
| MinIO Console | 9001 | Started with MinIO |
| Mock render worker | 8090 | Auto-started by edge function tests |
| Real render worker (local dev) | 8090 | `PORT=8090 npx tsx render-worker/src/server.ts` |
| Render worker (test instance) | 8095 | Auto-started by render worker tests |
| Media file server (test) | 9998 | Auto-started by render worker tests |

## Test helpers

- [test/helpers/supabaseClient.ts](helpers/supabaseClient.ts) — Authenticated Supabase clients for pro/trial test users
- [test/helpers/s3Client.ts](helpers/s3Client.ts) — S3 client for MinIO (upload, presigned URLs, existence checks)
- [test/helpers/testMedia.ts](helpers/testMedia.ts) — Generates minimal test media via ffmpeg (cached in tmpdir)
- [test/helpers/setupMinio.ts](helpers/setupMinio.ts) — Creates the `project-media` bucket in MinIO
- [test/helpers/mockRenderWorker.ts](helpers/mockRenderWorker.ts) — Mock render worker for edge function tests
- [test/helpers/mockMuxApi.ts](helpers/mockMuxApi.ts) — Mock Mux Video API for edge function tests
- [test/helpers/createProject.ts](helpers/createProject.ts) — Test project factory

## Docker networking

Edge functions run inside Docker (via `supabase functions serve`). They can't reach your Mac via `localhost` — they use `host.docker.internal` instead. That's why `supabase/.env.local` has URLs like `http://host.docker.internal:9000` (MinIO) and `http://host.docker.internal:8090` (render worker), while tests running on your Mac use `http://127.0.0.1:*`.

## Environment files

- `.env.test` — Loaded by vitest before tests run. Contains local Supabase keys, test user credentials, and render secret.
- `supabase/.env.local` — Loaded by `supabase functions serve`. Contains S3/MinIO config, mock Mux config, render worker URL.
