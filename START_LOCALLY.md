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

# 2. Edge functions (uploads and any functions not yet migrated to the server)
supabase functions serve --env-file supabase/.env.local

# 3. Fastify server — runs at http://localhost:8080 (the webapp routes
#    migrated API calls here via VITE_API_URL in .env.development.local)
(cd server && npm run dev)

# 4. Webapp — runs at http://localhost:3001
npm run dev:webapp

# 5. Stripe webhook forwarding (only if testing billing) — stripe-webhooks
#    moved from the edge functions to the fastify server
stripe listen --forward-to http://localhost:8080/stripe-webhooks
```

**Local ports:** render worker **8090**, fastify server **8080**, webapp 3001, Supabase 54321. The worker port is baked into `supabase/.env.local` (`RENDER_WORKER_URL=http://host.docker.internal:8090`) and `server/.env.local` (`http://localhost:8090`); the server port into `webapp/.env.development.local` (`VITE_API_URL`) and `server/.env.local` (`PORT`, `PUBLIC_URL`). Change one, change them together.

**Storage bucket:** the webapp uploads project media to the `project-media` Supabase Storage bucket. It's declared in `supabase/config.toml` (`[storage.buckets.project-media]`) so it's created automatically on `supabase start`. If uploads fail with tus 404 "Bucket not found", the bucket is missing — restart Supabase or create it directly:

```sql
insert into storage.buckets (id, name) values ('project-media', 'project-media');
```

**Stripe gotcha:** each `stripe listen` session prints a new `whsec_...` secret. Paste it into `STRIPE_WEBHOOK_SECRET` in `server/.env.local` and restart the server. The `sk_test_...` key and price IDs in that file persist and don't need touching.

### Optional extras

```bash
# Render worker (needed for export/render features)
PORT=8090 npx tsx --env-file=render-worker/.env.local render-worker/src/server.ts
```

### Media storage (local)

All media lives in local Supabase Storage (`project-media` bucket): the webapp
uploads via tus, and edge functions read the same store through its
S3-compatible endpoint (`http://127.0.0.1:54321/storage/v1/s3`, keys from
`supabase status -o env`, configured in `supabase/.env.local`). Browse files in
Studio → Storage at http://127.0.0.1:54323.

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
