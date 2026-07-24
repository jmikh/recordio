# Part 2.1 — Assets RPC Migration (Batch 1 design)

> **2026-07-24 pivots (two, same day):** Part 2 switched from proxying
> the SQL functions (claims injection) to porting their logic inline,
> and then to **regular routes with a hard cutover** — see the parent
> doc's "Core approach"/"Server design". This batch was shipped as a
> proxy, reworked to inline SQL, then reworked to regular routes
> (`/asset-list`, `/asset-delete` via `invokeFunction`; the
> registry/flag wrapper deleted). Design sections below that mention
> `callRpc`, claims injection, `/rpc/*` paths, or the `rpc()` wrapper
> describe superseded approaches; the Status section records what is
> actually live.

Child of `fastify-part2-rpc-proxy-migration.md`. Scope: `asset_list` and
`asset_delete` move behind the server, and — the one deliberate behavior
change in Part 2 — `asset_list` responses are enriched with presigned
download URLs so the asset flow stops calling `/storage-download-urls`
entirely. This is also the **pilot batch**: it lands the shared Part 2
foundations (claims-injection gate, `callRpc` helper, client `rpc()`
wrapper + registry) that every later batch reuses.

Design only — no implementation yet.

## Why the enrichment (user decision 2026-07-24)

Today the client learns `storage_path` from `asset_list`, then hands those
paths back to the generic presigner (`/storage-download-urls`) on cache
miss. Client-held storage paths round-tripping through a generic presigner
is a standing bug source — any code path can ask to presign any string,
and correctness rests on the route's prefix check plus the client passing
the right paths. Instead, the server presigns **at listing time**, where
ownership is already established by the SQL (`user_id = auth.uid()`). The
client gets ready-to-fetch URLs and never needs to know that storage paths
are meaningful. `storage_path` remains in the response — it is still the
client-side identity/cache key for now (can be revisited later, e.g.
keying the cache on asset id).

After this batch, the entire asset lifecycle is server-mediated: upload
(`/asset-upload`, Wave B), list + download URLs (`/rpc/asset_list`),
delete (`/rpc/asset_delete`). `/storage-download-urls` keeps its other
callers (project media via `BlobCache`/`cloudStorage`, cloud-render
downloads) — shrinking its surface further is a per-domain question for
later batches, not this one.

## Current flow (verified 2026-07-24)

1. `useAssetLibraryStore.load()` → `UserAssetService.listAssets(type)` →
   `supabase.rpc('asset_list', { p_asset_type })` → rows
   `{ id, asset_type, storage_path, name, size_bytes, created_at }`
   (RETURNS JSONB array, `'[]'` when empty).
2. The store pre-resolves blob URLs: `BlobCache.getBlobUrls(paths)` —
   cache hits become object URLs; misses batch through
   `CloudStorage.requestDownloadUrls(misses)` → `/storage-download-urls`
   → direct S3 GET → Cache API.
3. Later resolves (`resolveBlobUrl`) go through `BlobCache.getBlobUrl` →
   on miss `CloudStorage.downloadMediaFile(path)` → same presigner route.
4. `deleteAsset(id)` → `supabase.rpc('asset_delete', { p_asset_id })` →
   returns the `storage_path` (TEXT, NULL if not found/not owned) →
   `BlobCache.evict(path)`.
5. Upload is already server-side (`/asset-upload` single-request
   multipart); it seeds the cache via `BlobCache.put`, so fresh uploads
   never need a download URL.

## Server design

### `POST /rpc/asset_list`

- `requireUser`; body `{ p_asset_type: 'background' | 'music' }` (TypeBox
  enum, mirroring the SQL signature).
- Handler: `callRpc(db, userId, 'asset_list', ...)` (the shared Part 2
  helper — this batch builds it), then enrich each row:
  `download_url: await s3.presignDownload(row.storage_path, EXPIRY)` via
  the existing `S3Port` (`server/src/adapters/s3.ts`, already wired).
  Presigning is local HMAC — no network call, so ≤10 rows per type is
  free.
- Response: the SQL rows verbatim + `download_url` per row. Passthrough
  (no strict response schema), per the Part 2 decision.
- **URL expiry: 1 hour** (same as `/storage-download-urls`). Expiry is a
  non-issue in the common path — `load()` resolves misses immediately
  after listing. The rare late-miss case is handled client-side (below),
  not with longer-lived URLs.
- Log fields: `rpc.fn`, plus `storage.path_count` (row count presigned —
  reuses the existing field).

### `POST /rpc/asset_delete`

- Pure proxy, no enrichment. `requireUser`; body `{ p_asset_id: string }`.
- `callRpc(..., 'asset_delete', ..., resultShape: 'scalar')` → data is the
  storage path or `null` (not-found and not-owned are both NULL — SQL
  parity, kept).

### Foundations landed with this batch (shared by all of Part 2)

- The claims-injection contract test — **the gate**: `auth.uid()` NULL on
  a bare pool query, equals the injected `sub` in-transaction, NULL again
  after. If it can't pass, stop and rediscuss Part 2.
- `server/src/rpc.ts` `callRpc` helper (transaction + `set_config` +
  named-arg call + result shaping) with its own unit/e2e tests.
- Error mapping (pg error → 400 PostgrestError-shaped body). Note: neither
  asset fn RAISEs — the mapping gets exercised properly in later batches;
  here it only needs a does-not-explode test.
- `webapp/src/api/rpc.ts` wrapper + `MIGRATED_RPCS` + `VITE_USE_SERVER_RPC`
  (design in the parent doc).

## Client design

- `UserAsset` gains `downloadUrl: string`; `listAssets` maps
  `row.download_url`. `listAssets` switches to `rpc('asset_list', ...)`;
  `deleteAsset` to `rpc('asset_delete', ...)` (unchanged contract:
  `{ data, error }`, scalar path or null).
- **BlobCache learns to accept supplied URLs** instead of fetching its
  own for asset paths: a variant such as
  `getBlobUrls(entries: { storagePath, downloadUrl }[])` (or an optional
  `urls` map param on the existing methods — decide at implementation;
  smallest diff wins). Cache keys stay `storagePath`. The generic
  path-only methods remain for project media.
- `useAssetLibraryStore`:
  - `load()` passes each asset's `downloadUrl` into the pre-resolve batch.
  - `resolveBlobUrl(storagePath)` looks up the asset in store state to get
    its `downloadUrl` on cache miss.
  - **Late-miss/expiry handling:** if a direct download fails (expired URL
    — possible when a miss is resolved >1 h after listing), re-call
    `listAssets` for that type once to get fresh URLs and retry. One
    retry, then surface the error as today. The list IS the URL source —
    no fallback to `/storage-download-urls`.
- `canUpload`/`AssetLibraryFullError`/upload flow: untouched.

## Definition of done (per parent-doc DoD, specialized)

- Gate: claims-injection contract test green against real local Postgres.
- e2e per route on real seeded Postgres: list happy path (only ready +
  not-deleted + caller's own + type-filtered rows; `download_url` present
  and S3-shaped; ordering by created_at desc), empty list → `[]`, 401
  without token, delete happy path (row soft-deleted, path returned),
  delete not-owned/not-found → null data + **DB-state assertion** (other
  user's row untouched), canonical log fields.
- Presign verified once against the local stack S3 (existing adapter
  integration pattern) — the returned URL actually downloads the object.
- Client: wrapper unit tests (registry off/on, fallback, error shape);
  asset service/store tests updated for `downloadUrl` + the retry-once
  path; both call sites swapped; names registered.
- Root vitest, server typecheck, webapp `tsc -b`, eslint clean on changed
  files.
- Manual local verification (flag-on local webapp → prod Railway server):
  asset library loads with thumbnails, upload → appears, delete → gone,
  cold-cache reload downloads via the new URLs — **zero
  `/storage-download-urls` requests for assets in the network tab**.
- User go-ahead → prod webapp deploy cuts the batch over. Rollback:
  unregister the two names (or flag off) and redeploy.

## Open questions / notes

- Cache/identity key stays `storagePath` for now (user: "storage path is
  the id for now… we can change it later"). If it later becomes asset id,
  BlobCache keying and `asset_delete`'s return contract change together.
- The webapp currently maps rows through `(row: any)` — the wrapper's
  typed `rpc<T>` can carry a proper row type; keep the mapping shape
  otherwise identical.
- Presigning inside `asset_list` means listing now requires the S3 adapter
  to be configured — already required in prod since Wave A #1; the fakes
  suite uses the existing S3 fake.

## Status

- 2026-07-24 — designed (with parent-doc updates: folders skipped, assets
  promoted to pilot).
- 2026-07-24 — **CODE COMPLETE.** All landed:
  - **Gate PASSED** (verified live via psql first, then pinned in
    `server/test/rpc.test.ts`): `auth.uid()` NULL on a bare pool query,
    equals the injected sub in-statement, NULL again on the next statement
    of the same (max-1) pooled connection.
  - **Implementation refinement over the design:** no explicit
    BEGIN/COMMIT — `callRpc` is ONE statement
    (`WITH cfg AS (SELECT set_config(..., true)) SELECT fn(...) FROM cfg`);
    the transaction-local setting dies with the statement (autocommit), so
    the unchanged `Db.query` port suffices and the pattern survives even a
    transaction-mode pooler. `resultShape: 'rows'` is deliberately
    unimplemented until a SETOF fn needs it (lateral-ordering caveat noted
    in code).
  - Server: `src/rpc.ts` (`callRpc`, `RpcError` — SQLSTATE classes
    P0/22/23 → 400 PostgrestError-shaped body via `rpcErrorHandler`,
    anything else stays 500), `src/routes/rpc/assets.ts` registered under
    `/rpc` in app.ts, `rpc.fn` in DomainLogFields. `seedUserAsset` gained
    `createdAt`.
  - Client: `webapp/src/api/rpc.ts` (`rpc()`, `MIGRATED_RPCS` =
    {asset_list, asset_delete}, `VITE_USE_SERVER_RPC` flag → typed in
    vite-env.d.ts + .env.example), `UserAsset.downloadUrl?`, BlobCache
    knownUrl/knownUrls params (generic path-only flow untouched for
    project media), store passes URLs through + retry-once via fresh
    `listAssets` on late-miss failure (no presigner fallback).
  - Tests (+40): `rpc.test.ts` 7 (gate + identifier discipline + 22P02
    mapping), `assetsRpc.test.ts` 12 (401/schema-400 pre-query via
    throwing db; e2e: filtering/ordering/enrichment/expiry, [] parity,
    soft-delete + not-owned row-untouched + unknown → null, canonical log
    fields; containment-based asserts — assetUpload seeds the same users
    in parallel), `api/rpc.test.ts` 10 (routing/fallback/error shapes/401
    funnel), `userAssetService.test.ts` 5, `useAssetLibraryStore.test.ts`
    6 (knownUrls batch, retry-once pins).
  - Checks: root vitest 383 passed (single failure = the KNOWN
    pre-existing cloudProjectService stale expectation; S3/Stripe adapter
    integrations skipped without creds), both typechecks clean, eslint
    clean on changed files (one pre-existing finding verified on HEAD).
- 2026-07-24 — **HTTP smoke test PASSED against the running local server**
  (real local stack: real token via password grant, real Postgres, real S3
  adapter): `/asset-upload` (1×1 png) → `/rpc/asset_list` returned the row
  with a real presigned `download_url` (X-Amz-Expires=3600) → direct
  download via that URL byte-identical → `/rpc/asset_delete` returned the
  path → re-list `[]`. Test row hard-deleted afterwards. Noted en route:
  schema-validation 400 precedes the 401 on /rpc routes (Fastify
  lifecycle; same as every Part 1 preHandler route — only the email
  routes pin auth-first via onRequest).
- 2026-07-24 — **USER VERIFIED** ("tested", chat). Batch 1 is done;
  prod cutover happens with the user's commit+push + webapp deploy.
- 2026-07-24 — **REWORKED TO INLINE SQL** (the Part 2 pivot; user chose
  "rework now" + "delete claims machinery entirely"):
  `routes/rpc/assets.ts` now runs the ported queries directly —
  asset_list is one SELECT (`WHERE user_id = $1 …` with
  `size_bytes::int` and `to_jsonb(created_at)` preserving the fn's exact
  number/string renderings, `ORDER BY created_at` — the column, which
  quietly fixes the text-ordering smell on the live path) + the presign
  enrichment; asset_delete is one
  `UPDATE … WHERE id AND user_id RETURNING storage_path`.
  DELETED: `server/src/rpc.ts` (callRpc/RpcError/rpcErrorHandler) and
  `server/test/rpc.test.ts` (claims contract tests) — no set_config
  anywhere. Client contract unchanged (wrapper/registry/flag untouched).
  **All 12 route tests pass UNCHANGED** — the same assertions that
  verified the proxy verify the port; typecheck clean. NOTE: the running
  local server (tsx, no watch) needs a restart to serve the inline
  version.
- 2026-07-24 — **REWORKED AGAIN: regular routes, hard cutover** (pivot
  2 — no RPC-specific style): routes are now `/asset-list` +
  `/asset-delete` (`routes/assetList.ts`, `assetDelete.ts` — flat,
  Part 1 conventions, full request AND response schemas, camelCase
  client-shaped bodies: `{ assetType }` → `{ assets: [...] }` with
  fields matching `UserAsset` verbatim; `{ assetId }` →
  `{ storagePath: string | null }`). Client: `userAssetService` calls
  `invokeFunction` directly; DELETED: `webapp/src/api/rpc.ts` + its
  tests (registry/flag/fallback), `VITE_USE_SERVER_RPC` (vite-env.d.ts,
  .env.example — which also got the 8090→8080 port fix), `rpc.fn` log
  field, `routes/rpc/` folder. Old assetsRpc tests split per-route
  (`assetList.test.ts` 6, `assetDelete.test.ts` 6) + service tests
  rewritten (4). Checks: 365 passed / known pre-existing failure only;
  both typechecks + eslint clean. Rollback story is now git revert +
  redeploy (user decision — low usage); the frozen SQL fns remain
  deployed for exactly that. The user's webapp/.env still contains a
  now-inert `VITE_USE_SERVER_RPC=true` line — safe to drop anytime.
  Server restart still pending to serve the new paths.
- **Remaining (user):** browser click-through per the DoD (asset library
  loads, upload, delete, cold-cache reload with ZERO
  /storage-download-urls requests for assets in the network tab).
  `VITE_USE_SERVER_RPC=true` is already in webapp/.env (user-set), but its
  `VITE_API_URL` points at prod Railway — the /rpc routes are NOT deployed
  yet (nothing committed): either commit+push first (Railway deploys; the
  new routes are additive and inert for the prod webapp, which has no
  VITE_USE_SERVER_RPC) and verify against prod per the Part 1 posture, or
  point VITE_API_URL at the local server (http://localhost:8080 — NOT
  8090, that's the render worker) for a fully local pass. Then go-ahead →
  prod webapp deploy with the flag baked in. Rollback: flag off (or
  unregister the two names) and redeploy. No new server env vars.
