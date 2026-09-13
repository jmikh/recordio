# Running Recordio Locally

All commands run from the repo root unless noted.

## Startup (local dev, one terminal each)

```bash
# 1. Local Supabase (DB, auth, storage — Studio at http://127.0.0.1:54323)
supabase start

# 1b. Apply any migrations added since your local DB was created
#     (supabase start does NOT run new migrations on an existing volume;
#      symptoms: RLS errors like "new row violates row-level security policy")
supabase migration up

# 2. Fastify server — runs at http://localhost:8080 (the webapp routes
#    API calls here via VITE_API_URL in .env.development.local).
#    There is no `supabase functions serve` step: the edge functions were
#    decommissioned (2026-07-24) and supabase/functions/ is empty.
npm run dev:server

# 3. Webapp — runs at http://localhost:3001
npm run dev:webapp

# 4. Render worker — only for cloud render/export. Build the render page
#    first (see "Render worker" below), then start the worker on 8090.
npm run build:render-page
npm run dev:render-worker

# 5. Stripe webhook forwarding (only if testing billing) — stripe-webhooks
#    moved from the edge functions to the fastify server
stripe listen --forward-to http://localhost:8080/stripe-webhooks
```

**Local ports:** render worker **8090**, fastify server **8080**, webapp 3001, Supabase 54321. The worker port is baked into `server/.env.local` (`RENDER_WORKER_URL=http://localhost:8090`); the server port into `webapp/.env.development.local` (`VITE_API_URL`) and `server/.env.local` (`PORT`, `PUBLIC_URL`). Change one, change them together.

**Storage bucket:** the webapp uploads project media to the `project-media` Supabase Storage bucket. It's declared in `supabase/config.toml` (`[storage.buckets.project-media]`) so it's created automatically on `supabase start`. If uploads fail with tus 404 "Bucket not found", the bucket is missing — restart Supabase or create it directly:

```sql
insert into storage.buckets (id, name) values ('project-media', 'project-media');
```

**Stripe gotcha:** each `stripe listen` session prints a new `whsec_...` secret. Paste it into `STRIPE_WEBHOOK_SECRET` in `server/.env.local` and restart the server. The `sk_test_...` key and price IDs in that file persist and don't need touching.

### Optional extras

```bash
# Email previews — renders every template (welcome, invite, seat change)
# with sample data to server/.email-preview/ and opens them in the
# browser; nothing is sent
(cd server && npm run email:preview)
```

### Render worker

Needed only for cloud render (editor → Download → render in the cloud). The
flow is webapp → `POST /render-job-create` on the Fastify server → `POST
/render` on the worker → worker downloads the media from signed Supabase
Storage URLs, renders in headless Chromium, posts progress back to
`PUBLIC_URL/render-job-webhook`, uploads the MP4.

```bash
npm run build:render-page   # build render-worker/render-page
npm run dev:render-worker   # PORT=8090, health check at /health
```

**Always rebuild the render page after touching `shared/`.** The worker renders
by loading `render-worker/render-page/dist` inside Playwright, and that bundle
contains a compiled copy of the `shared/export/` pipeline. A stale `dist` renders
with old code and fails silently — no error, just the wrong output.

**Port 8090 is not optional.** `render-worker/.env.local` sets `PORT=8080`, which
collides with the Fastify server; `npm run dev:render-worker` passes `PORT=8090`
inline, and Node's `--env-file` does not override an already-set variable. Running
`npm run dev` from inside `render-worker/` skips that override and collides.

`RENDER_SECRET` must match between `render-worker/.env.local` and
`server/.env.local` (the worker authenticates both directions with it). Chromium
comes from Playwright — `npx playwright install chromium` if the worker fails to
launch a browser at startup.

### Media storage (local)

All media lives in local Supabase Storage (`project-media` bucket): the webapp
uploads via tus, and the server reads the same store through its S3-compatible
endpoint (`http://127.0.0.1:54321/storage/v1/s3`, keys from `supabase status -o
env`, configured in `server/.env.local`). Browse files in Studio → Storage at
http://127.0.0.1:54323.

MinIO is no longer used for dev (it was only needed when uploads went through
presigned S3 multipart; tus replaced that). Integration tests may still expect
it — `docker compose up -d minio` if so.

## Webapp: prod vs local

Vite mode decides which env file wins (`webapp/src/supabase/client.ts` reads `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`):

- `npm run dev:webapp` → development mode → `webapp/.env.development.local` overrides, pointing at **local** Supabase (`http://127.0.0.1:54321`)
- `npm run dev:webapp:prod` → `--mode production` → only `webapp/.env` applies, pointing at **prod** (`https://api.recordio.io`)

## Extension: prod vs local

The extension has no Supabase config of its own — it just needs to know which webapp origin to hand recordings off to. That's decided at build time in `shared/types/bridge.ts` (`getEditorOrigin()`) via the `__DEV_MODE__` and `__USE_PROD_ORIGIN__` flags set in `extension/vite.config.ts`:

```bash
# Dev build → uploads to localhost:3001 (local webapp)
npm run build:extension:dev

# Dev build but pointing at prod (https://app.recordio.io)
USE_PROD_ORIGIN=true npm run build:extension:dev

# Full prod build (always prod origin, minified, zips extension.zip)
npm run build:extension
```

There's also `npm run dev:extension` for watch mode. Load the unpacked extension from `extension/dist`.

Note: "extension uploads to prod" really means extension → prod webapp → prod Supabase. If you point the extension at localhost but run the webapp with `dev:webapp:prod`, uploads would land in prod through your local webapp — keep this in mind when mixing modes.
