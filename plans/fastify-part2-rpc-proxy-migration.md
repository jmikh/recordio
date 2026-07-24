# Part 2 — RPC Proxying through Fastify (Design)

Scope: move all client-called Postgres RPCs behind Fastify routes, batched
by domain. The SQL functions themselves are **not rewritten** — the server
calls the exact same functions the client calls today. Out of scope: auth,
storage uploads (TUS), business-logic consolidation (Part 3), the folders
domain (feature being deprecated — see survey), and every hardening item in
`plans/suggested_changes.md` (proxying keeps behavior 1:1; new smells get
logged there, not fixed here). One deliberate behavior exception:
`asset_list` gains server-side download-URL enrichment — designed in
`fastify-part2-1-assets-rpc-migration.md`.

Exit criteria: `grep -r "supabase.rpc" webapp/` returns nothing;
`supabase-js` in the client is used only for auth and TUS storage uploads;
the migration registry/flag machinery is collapsed (same as Part 1 Step 5);
the SQL functions are unchanged.

## Current surface (verified against code 2026-07-24)

**28 RPCs in scope** (32 distinct client-called minus the 4 folder fns,
see below), ~35 call sites, 13 webapp files. All SECURITY DEFINER, all
`auth.uid()`-dependent (directly or via the `assert_*` helpers); the 5
explicit-param functions
(`mux_video_complete`, `mux_video_get_or_create`, `render_job_get_or_create`,
`render_job_complete`, `user_profile_create`) are already server/trigger
territory and are NOT part of this migration.

Findings from the survey:

- **Folders are being deprecated (user decision 2026-07-24):**
  `folder_list`, `folder_create`, `folder_update`, `folder_delete` do NOT
  migrate — the feature and its call sites (`cloudStorage.ts`,
  DashboardPage) are removed separately, outside this migration. The
  exit-criteria grep therefore also depends on that deprecation landing.
  `project_move_to_folder` presumably dies with it — confirm before the
  projects batch; it stays listed there as conditional until then.
- **`trial_start` has NO client caller** — its header says "Called by:
  client RPC" but no `.rpc('trial_start')` exists anywhere in the repo.
  Confirm with the user whether trials are started some other way; if truly
  orphaned it's a decommission candidate (graveyard), not a Part 2 route.
- `asset_confirm_upload` is already dropped (orphaned by the single-request
  `/asset-upload` route, see `sql/graveyard.sql`) — the assets domain is
  just `asset_list` + `asset_delete`.
- `subscription_get` is the one function with server-side inline copies
  (stripe-portal, subscription-change ported its join inline because
  `auth.uid()` is NULL over the pool). After Batch 5 migrates its last
  client caller, it becomes server-exclusive → Part 3 can consolidate the
  three implementations into one TS service. Until then: no forks, the SQL
  stays authoritative for client callers.
- `workspace_invite` fires a pg_net call to the server's
  `/send-workspace-invite-email` route from inside the SQL. Proxying does
  not change this — pg_net fires regardless of who calls the function.
  (Local-dev caveat from Wave E: the local Vault bearer may mismatch
  `.env.local`'s key format, so the local email hop can 401 — known,
  harmless.)

## Core mechanism: JWT-claims injection (the one architectural decision)

`auth.uid()` reads `request.jwt.claims` via `current_setting(...)`. Over
the server's pg pool that GUC is unset → NULL → every membership check
fails. Instead of rewriting 27 function signatures (fork risk during
cutover) or porting logic to TS (that's Part 3), the server does exactly
what PostgREST does — set the claims for the transaction, then call the
function:

```sql
BEGIN;
SELECT set_config('request.jwt.claims',
                  '{"sub":"<user-id>","role":"authenticated"}', true);
SELECT * FROM folder_list(p_workspace_id => $1);
COMMIT;
```

- `set_config(..., true)` is transaction-local: it can't leak across pooled
  connections, and nested calls (the `assert_*` helpers) see it because
  they run in the same transaction.
- Zero SQL changes. The same function serves `supabase.rpc` callers and
  proxied callers during the entire cutover window.
- **Verify-first step (Batch 1 gate):** a contract test against the real
  local Postgres pins the mechanism — `auth.uid()` is NULL over a bare
  pool query, equals the injected `sub` inside the transaction, and is
  NULL again on the next query from the same connection. If this test
  can't be made to pass, stop and rediscuss before building anything on
  top. Per-function claim needs beyond `sub`/`role` (e.g. `email`) are
  checked per batch while porting (none expected).

## Server design

- **Routes:** `POST /rpc/<fn_name>` (exact snake_case SQL name — greppable,
  one glance from route to SQL file, and the `/rpc/` prefix keeps the
  namespace and log filtering clean). One route module per domain
  (`server/src/routes/rpc/folders.ts`, `assets.ts`, `projects.ts`,
  `workspaces.ts`, `session.ts`), registered under a `/rpc` prefix plugin.
- **Auth:** existing `requireUser`; the verified `sub` is what gets
  injected — the client never supplies an identity.
- **DB helper:** one shared `callRpc(db, userId, fnName, args, resultShape)`
  in `server/src/rpc.ts` doing the transaction + `set_config` + named-arg
  call (`p_x => $1`). The fn name and arg names come from route code only —
  never from request input; request values travel exclusively as bind
  params. `resultShape: 'scalar' | 'rows' | 'void'` is declared per route
  to reproduce supabase-js semantics exactly (RETURNS JSONB → the value,
  SETOF/TABLE → array, void → null).
- **Request schemas:** strict TypeBox per RPC (arg names/types mirror the
  SQL signature). **Response schemas: none / passthrough** — Fastify
  serialization strips properties not in the schema, which would silently
  break parity on JSONB-returning functions. The response is the SQL
  result, verbatim. (Deliberate divergence from Part 1's
  full-response-schema discipline, documented here.)
- **Error mapping:** a `RAISE EXCEPTION` surfaces via supabase-js as
  `error.message` (PostgREST → 400, code P0001). The proxy mirrors it:
  pg errors from the fn call → 400 with
  `{ message, code, details?, hint? }` (PostgrestError-shaped). Unexpected
  errors keep Fastify's default 500. Each batch audits its call sites for
  which error fields they actually read (toast messages in MembersPage
  etc.) and pins those in tests.
- **Logging:** `rpc.fn` added to `DomainLogFields`; the canonical
  per-request event covers the rest. No per-route rate limits (authed CRUD;
  the global backstop applies).

## Client design

- `webapp/src/api/rpc.ts`: `rpc<T>(name, args)` returning the
  supabase-shaped `{ data, error }` so call-site swaps are mechanical.
  Fetches `${VITE_API_URL}/rpc/${name}` through `authAwareFetch` (same 401
  funnel as `invokeFunction`); non-2xx with a PostgrestError-shaped body →
  that object as `error`.
- **Registry + flag, same posture as Part 1:** `MIGRATED_RPCS` set +
  `VITE_USE_SERVER_RPC` env flag; unregistered names (or flag off) fall
  through to `supabase.rpc`. Difference from Part 1: the prod flag goes ON
  from Batch 1 and **the committed registry is the per-batch cutover
  switch** — proxy routes run the same SQL, so the risk profile that made
  Part 1 defer its prod flip (a server being rewritten under churn) doesn't
  apply. Rollback per batch = revert the registry entries and redeploy;
  flag off = revert everything at once.
- Final step (after all batches soak): collapse the wrapper server-only,
  delete registry + flag + supabase fallback — Part 1 Step 5 pattern.

## Batches (risk order, lowest first)

Cadence: one batch at a time — code + tests + call-site swap + local
verification (flag-on local webapp against the prod Railway server), then
**pause for explicit go-ahead**, then the prod webapp deploy cuts the batch
over. Nothing SQL-side is deleted at any point.

### Batch 1 — Folders (pilot, 4 fns)

`folder_list`, `folder_create`, `folder_update`, `folder_delete` — all in
`storage/cloudStorage.ts`. Smallest domain, low stakes, exercises the full
stack: claims-injection contract test (the gate above), the `callRpc`
helper, error mapping, client wrapper + registry, one mutating fn with a
DB-state assertion. Everything after this batch is repetition.

### Batch 2 — Assets (2 fns)

`asset_list`, `asset_delete` — `storage/userAssetService.ts`.
Trivial; confirms the pattern holds outside cloudStorage.

### Batch 3 — Projects + render status (12 fns)

`project_get` (3 sites: cloudStorage ×2, Header), `project_list`,
`project_update`, `project_update_name`, `project_rename`, `project_star`,
`project_share` (Header), `project_restore`, `project_delete`,
`project_move_to_folder`, `project_confirm_upload` (cloudStorage),
`render_job_get_status` (useCloudRender polling). The core editor +
dashboard flows — biggest batch, but uniform CRUD. Notes:
`project_update` carries full project_data JSONB (response passthrough
matters here); `project_confirm_upload` sits in the upload flow that
Part 4 later replaces — proxying now is still correct (the flow around it
doesn't change); `render_job_get_status` polls during renders — verify
cadence looks fine in Railway logs after cutover.

### Batch 4 — Workspaces, members, invites (11 fns)

`workspace_list` (Dashboard, WorkspaceSettings), `workspace_get`,
`workspace_create`, `workspace_rename`, `workspace_set_default`
(switchWorkspace), `workspace_seats_set`, `workspace_member_update_role`,
`workspace_member_remove`, `workspace_invite` (×2 MembersPage),
`workspace_invite_rescind`, `workspace_invite_accept` (AcceptInvitePage).
Notes: `workspace_invite`'s pg_net email hop (see survey); MembersPage
reads business-rule error messages (seat limits etc.) — the error-mapping
audit matters most here; `workspace_invite_accept` runs right after
sign-in on AcceptInvitePage — verify the session token is available to the
wrapper in that flow.

### Batch 5 — Session/identity (3 fns, last: login-path blast radius)

`user_profile_get`, `workspace_get_default` (AuthManager + ImportPage),
`subscription_get` (AuthManager, BillingPage, switchWorkspace). These run
on every login/workspace switch — any wrapper bug here logs everyone into
a broken state, hence last, after the mechanism has soaked through four
batches. After this batch `subscription_get` is server-exclusive (Part 3
consolidation candidate, see survey).

## Definition of done (every batch)

- TypeBox request schema per RPC; e2e tests per RPC against the real
  seeded local Postgres: happy path, the SQL's own authz failures
  (non-member / wrong role), RAISE → 400 error-shape parity for whatever
  fields the call sites read, 401 without a token, DB-state assertions for
  mutating fns, canonical log fields incl. `rpc.fn`.
- Client wrapper unit tests (registry off/on, fallback, error shape) —
  Batch 1 only, then extended if the wrapper changes.
- All call sites swapped to `rpc()`; names registered in `MIGRATED_RPCS`.
- Root vitest, server typecheck, webapp `tsc -b`, eslint clean on changed
  files.
- Manual local verification by the user (flag-on local webapp → prod
  Railway server), explicit go-ahead, then prod webapp deploy.

## Risks / watch list

- **Claims-injection drift:** if Supabase changes how `auth.uid()` reads
  claims, the contract test catches it (it runs in blocking CI against the
  local stack, which tracks Supabase versions).
- **Connection pool pressure:** every RPC now transits the server's direct
  connection (pool max 10, always-on single instance). Fine at current
  traffic; if saturation shows in logs, point `DATABASE_URL` at Supavisor
  (README documents the trade-off) — no code change.
- **Error-shape parity** is the likeliest source of subtle breakage
  (PostgrestError fields, null-vs-empty data shapes). Mitigated by the
  per-batch call-site audit + pinned tests, and by `resultShape` being
  explicit per route instead of inferred.
- **`trial_start` orphan question** — ask the user before Batch 5; if
  orphaned, graveyard it in a separate, explicit step (not silently inside
  a batch).

## Status

- 2026-07-24 — design agreed (claims injection, domain batches, registry
  cutover). Nothing implemented yet. Next: Batch 1 (folders) including the
  claims-injection contract-test gate.
