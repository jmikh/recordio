# Running Recordio Locally

All commands run from the repo root unless noted.

## Startup (local dev, one terminal each)

```bash
# 1. Local Supabase (DB, auth, storage — Studio at http://127.0.0.1:54323)
supabase start

# 2. Edge functions (required for stripe, uploads, etc.)
supabase functions serve --env-file supabase/.env.local

# 3. Webapp — runs at http://localhost:3001
npm run dev:webapp

# 4. Stripe webhook forwarding (only if testing billing)
stripe listen --forward-to http://127.0.0.1:54321/functions/v1/stripe-webhooks
```

**Stripe gotcha:** each `stripe listen` session prints a new `whsec_...` secret. Paste it into `STRIPE_WEBHOOK_SECRET` in `supabase/.env.local` and restart the `functions serve` terminal. The `sk_test_...` key and price IDs in that file persist and don't need touching.

### Optional extras

```bash
# Render worker (needed for export/render features)
PORT=8090 npx tsx --env-file=render-worker/.env.local render-worker/src/server.ts

# MinIO — local S3 (needed for uploads/integration tests)
docker compose up -d minio
```

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
