# Part 2 — RPC Migration: client RPCs → server routes with inline SQL

Scope: move all client-called Postgres RPCs behind Fastify routes, batched
by domain, **porting each function's logic inline into the route** (plain
SQL over the pool with explicit `$user_id` params — no `auth.uid()`, no
claims machinery). This absorbs what the overview called Part 3 for the
client-called functions: after Part 2 there is no separate consolidation
phase for them. The SQL functions are NOT edited or dropped during the
migration — they stay deployed, frozen, as the rollback target until the
final sweep. Out of scope: auth, storage uploads (TUS), the folders
domain (deprecated 2026-07-24), and every hardening item in
`plans/suggested_changes.md` (ports keep behavior 1:1 unless a divergence
is explicitly documented; new smells get logged there, not fixed here).
One deliberate behavior exception: `asset_list` gains server-side
download-URL enrichment — designed in
`fastify-part2-1-assets-rpc-migration.md`.

Exit criteria: `grep -r "supabase.rpc" webapp/` returns nothing;
`supabase-js` in the client is used only for auth and TUS storage uploads;
then the **decommission sweep**: graveyard all migrated SQL functions plus
any `assert_*` helpers left with zero callers (zero-caller grep before
each drop, per the Part 1 pattern — user runs `sql/deploy.sh`).

## Current surface (verified against code 2026-07-24)

**26 RPCs in scope** (32 distinct client-called minus the 6
folders/starred fns removed by the 2026-07-24 deprecation, see below).
All SECURITY DEFINER, all `auth.uid()`-dependent (directly or via the
`assert_*` helpers); the 5 explicit-param functions
(`mux_video_complete`, `mux_video_get_or_create`, `render_job_get_or_create`,
`render_job_complete`, `user_profile_create`) are already server/trigger
territory and are NOT part of this migration.

Findings from the survey:

- **Folders/starred deprecation LANDED (2026-07-24, same day):** the
  webapp has zero remaining call sites; migration
  `20260724122346_drop_folders_and_starred` + graveyard entries drop
  `folder_list/create/update/delete`, `project_move_to_folder`, AND
  `project_star` (none migrate), and project_list/project_get stop
  selecting the dropped columns. Push order documented in the migration
  header: webapp+server deploy → `sql/deploy.sh` → `db push`.
- **`trial_start` has NO client caller** — its header says "Called by:
  client RPC" but no `.rpc('trial_start')` exists anywhere in the repo.
  Confirm with the user whether trials are started some other way; if truly
  orphaned it's a decommission candidate (graveyard), not a Part 2 route.
- `asset_confirm_upload` is already dropped (orphaned by the single-request
  `/asset-upload` route, see `sql/graveyard.sql`) — the assets domain is
  just `asset_list` + `asset_delete`.
- `subscription_get` already has server-side inline copies (stripe-portal,
  subscription-change ported its join inline in Part 1). When Batch 4
  ports its last client caller, consolidate all of it into ONE shared
  server service in that same batch — don't add a third inline copy.
- `workspace_invite` fires a pg_net call to the server's
  `/send-workspace-invite-email` route from inside the SQL. Proxying does
  not change this — pg_net fires regardless of who calls the function.
  (Local-dev caveat from Wave E: the local Vault bearer may mismatch
  `.env.local`'s key format, so the local email hop can 401 — known,
  harmless.)

## Core approach: inline port (user decision 2026-07-24)

Each route reimplements its function's logic as plain SQL/TS over the
server's pool, with the verified `req.user.id` as an explicit bind param
wherever the SQL used `auth.uid()`. This is the Part 1 pattern
(stripe-portal's inline `subscription_get` join was the precedent) applied
to every client RPC — the end-state architecture directly, no transitional
proxy layer.

- **Access rules become explicit**: membership/ownership checks are ported
  as joins/WHERE clauses (or reuse existing server services like
  `services/projectAccess.ts`); the `assert_*` SQL helpers are not called.
- **Business errors become explicit**: a `RAISE EXCEPTION` whose message a
  call site reads (toasts etc.) is ported as an explicit 400 with a
  PostgrestError-shaped body (`{ message, code }`) carrying the exact
  message. Errors no call site reads keep Fastify defaults.
- **Hard cutover per batch (user decision 2026-07-24, low-usage app):**
  client call sites and server routes ship together in one go — no
  registry, no flag, no `supabase.rpc` fallback path in code. Rollback =
  git revert + webapp redeploy (the SQL functions stay deployed and
  frozen until the end sweep, so reverted code Just Works). This removes
  the fork window almost entirely: the SQL twin exists but nothing calls
  it except reverted builds.
- **History:** the original Part 2 design proxied the SQL functions via
  PostgREST-style JWT-claims injection (`set_config('request.jwt.claims',
  …)` — designed, gate-tested, and shipped in the Batch 1 pilot), then
  was superseded by this decision the same day; the claims machinery was
  deleted and Batch 1 reworked to inline SQL. Git history has it.

## Server design — regular routes, indistinguishable from Part 1's
(user decision 2026-07-24: no RPC-specific style or naming)

- **Routes:** flat kebab-case paths in the top-level namespace, exactly
  like the Part 1 routes — `POST /asset-list`, `/asset-delete`, later
  `/project-get`, `/workspace-rename`, … One route module per endpoint in
  `server/src/routes/` (camelCase file = route name, Part 1 convention).
  No `/rpc` prefix, no `routes/rpc/` folder.
- **Auth:** existing `requireUser`; `req.user.id` is the only identity —
  the client never supplies one.
- **Request/response shapes are CLIENT-shaped, not SQL-shaped** — with no
  fallback path there is no supabase.rpc parity constraint. camelCase
  fields, object-wrapped responses (`{ assets: [...] }`, not a bare
  array), no `p_` arg prefixes. NULL semantics that call sites key off
  (e.g. project_update's conflict signal) are preserved deliberately and
  pinned by tests, as named fields where possible
  (`{ cloudVersion: null }` beats a bare `null` body).
- **Schemas:** strict TypeBox request schemas; response schemas per
  route like every Part 1 route (the strip-unknown-props concern is gone
  now that the route owns its response shape) — EXCEPT routes returning
  arbitrary jsonb blobs (project_data etc.), which skip the response
  schema. **Ajv-coercion gotcha (found in Batch 2):** never model an
  omittable numeric field as `Union([Integer, Null])` — Fastify's
  default Ajv coerces a JSON null to 0 via the integer branch. Use
  `Optional(Integer)` and have the client OMIT the key
  (JSON.stringify drops undefined); an explicit null still coerces to 0,
  so pick semantics where 0 fails safe and pin it with a test.
- **Business errors a call site reads** use the Part 1 pattern (e.g.
  asset-upload's `library_full`): 200/4xx with a typed error body the
  client checks explicitly — not PostgrestError reconstruction.
- **Logging:** the canonical per-request event + `http.route` identify
  everything; no RPC-specific fields. No per-route rate limits (authed
  CRUD; the global backstop applies).

## Client design

- **The existing `invokeFunction(name, body)` client
  (`webapp/src/api/client.ts`) — nothing RPC-specific.** Each migrated
  call site becomes an ordinary API call
  (`invokeFunction('asset-list', { assetType })`), identical to every
  Part 1 conversion. Errors are the usual
  FunctionsHttpError/FunctionsFetchError; business signals a call site
  needs come as typed response-body fields (server design above).
- **No registry, no flag, no supabase.rpc fallback** (removed 2026-07-24
  with the hard-cutover decision — `webapp/src/api/rpc.ts`,
  `MIGRATED_RPCS`, and `VITE_USE_SERVER_RPC` were built for the proxy
  design and deleted the same day; git history has them). Client and
  server for a batch ship together; rollback = git revert + redeploy.

## Batches (risk order, lowest first)

Cadence: one batch at a time — code + tests + call-site swap + local
verification (flag-on local webapp against the prod Railway server), then
**pause for explicit go-ahead**, then the prod webapp deploy cuts the batch
over. Nothing SQL-side is deleted at any point.

### Batch 1 — Assets (pilot, 2 fns) — DONE (inline SQL)

`asset_list`, `asset_delete` — `storage/userAssetService.ts` → regular
routes `/asset-list` + `/asset-delete` called via `invokeFunction`.
Landed the test patterns and the one deliberate divergence of Part 2 —
`asset-list` is enriched server-side with presigned download URLs so the
asset flow stops calling `/storage-download-urls`. Shipped first as a
claims-injection proxy under `/rpc/*` with a registry/flag wrapper, then
reworked twice the same day as the design pivoted (inline SQL → regular
routes, hard cutover). **Detailed design + status:
`fastify-part2-1-assets-rpc-migration.md`.**

### Batch 2 — Projects + render status (10 fns)

**Prompt: `fastify-part2-2-projects-rpc-migration-prompt.md`** (verified
signatures, shapes, call sites, parity pins). `project_get` (3 sites:
cloudStorage ×2, Header), `project_list`, `project_update`,
`project_update_name`, `project_rename`, `project_share` (Header),
`project_restore`, `project_delete`, `project_confirm_upload`
(cloudStorage), `render_job_get_status` (useCloudRender polling).
(`project_star`/`project_move_to_folder` died with the folders/starred
deprecation.) The core editor + dashboard flows. Notes: `project_share`
RETURNS TABLE → this batch implements callRpc's `'rows'` shape (with the
forced-ordering lateral); `project_update`'s NULL return IS the version
conflict the editor's whole conflict flow keys off — load-bearing parity
pin; `project_update` carries full project_data JSONB (response
passthrough matters); `project_confirm_upload` sits in the upload flow
Part 4 later replaces — proxying now is still correct;
`render_job_get_status` polls during renders — verify cadence in Railway
logs after cutover.

### Batch 3 — Workspaces, members, invites (11 fns)

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

### Batch 4 — Session/identity (3 fns, last: login-path blast radius)

`user_profile_get`, `workspace_get_default` (AuthManager + ImportPage),
`subscription_get` (AuthManager, BillingPage, switchWorkspace). These run
on every login/workspace switch — any wrapper bug here logs everyone into
a broken state, hence last, after the pattern has soaked through the
earlier batches. This batch also consolidates `subscription_get` with the
two Part 1 inline copies into one shared service (see survey).

## Definition of done (every batch)

- Request/response schemas live in `shared/api/` (the shared contract —
  `plans/shared-api-contract.md`) once that plan's Step 1 lands; new
  batch routes define their schemas there, never inline.
- Read the SQL source FIRST (`supabase/sql/functions/<fn>.sql`); port
  semantics 1:1 — access rules, NULL semantics, return shapes, and any
  RAISE message a call site reads. Divergences only when explicitly
  documented in the batch doc/prompt.
- TypeBox request schema per RPC; e2e tests per RPC against the real
  seeded local Postgres: happy path, the ported authz denials (non-member
  / wrong role / other-user), ported business-error bodies for whatever
  fields the call sites read, 401 without a token, DB-state assertions
  for mutating fns, canonical log fields incl. `rpc.fn`.
- All call sites swapped to `invokeFunction` — client and server changes
  land together (hard cutover; no transitional state in the codebase).
- Root vitest, server typecheck, webapp `tsc -b`, eslint clean on changed
  files.
- Anything noticed along the way that is out of scope for the batch —
  smells, dead code, security gaps, refactor candidates, stale docs — is
  ADDED to `plans/suggested_changes.md` (one bullet, source file + date
  found, per that file's own instructions), never fixed inline and never
  just mentioned in chat and lost.
- Manual local verification by the user (flag-on local webapp → prod
  Railway server), explicit go-ahead, then prod webapp deploy.

## Risks / watch list

- **Port divergence** is the likeliest source of subtle breakage: an
  access rule, NULL semantic, or error body that drifts from the SQL
  original (PostgrestError fields, null-vs-empty shapes, timestamptz
  rendering). Mitigated by read-the-SQL-first, the per-batch call-site
  audit, and pinned e2e tests per fn.
- **Hard cutover** means a broken batch is user-visible until a revert
  deploys — accepted explicitly (low usage). The SQL fns are never edited
  during Part 2 so a git revert always lands on a working fallback.
- **Connection pool pressure:** every RPC now transits the server's direct
  connection (pool max 10, always-on single instance). Fine at current
  traffic; if saturation shows in logs, point `DATABASE_URL` at Supavisor
  (README documents the trade-off) — no code change.
- **`trial_start` orphan question** — ask the user before Batch 4; if
  orphaned, graveyard it in a separate, explicit step (not silently inside
  a batch).

## Status

- 2026-07-24 — design agreed (claims injection, domain batches, registry
  cutover). Folders dropped from scope (feature being deprecated); assets
  promoted to pilot batch, with `asset_list` download-URL enrichment
  designed in `fastify-part2-1-assets-rpc-migration.md`.
- 2026-07-24 — **Batch 1 (assets) CODE COMPLETE — gate PASSED** (see the
  2-1 doc's status for details). Foundation refinement: `callRpc` needs no
  transaction plumbing — set_config + fn call are one statement, so the
  Db port is unchanged and the pattern is pooler-safe.
- 2026-07-24 — Batch 1 **user-verified** (HTTP smoke test end-to-end +
  user click-through). Folders/starred deprecation landed the same day
  (scope now 26 fns; project_star/project_move_to_folder dropped). Batch 2
  prompt written: `fastify-part2-2-projects-rpc-migration-prompt.md`.
  NOTE: nothing committed/pushed as of the prompt's creation — the /rpc
  routes reach prod Railway only after the user's commit+push.
- 2026-07-24 — **PIVOT (user decision): inline SQL instead of proxying.**
  Routes port each fn's logic directly (explicit `$user_id`); Part 3 is
  absorbed for client RPCs; SQL fns stay frozen as rollback until the
  end-of-part graveyard sweep. Claims-injection machinery DELETED
  (`server/src/rpc.ts`, its contract tests); Batch 1 reworked to inline
  SQL the same day (client-visible contract unchanged). Batch 2 prompt
  rewritten for inline ports.
- 2026-07-24 — **Batch 2 (projects + render status) CODE COMPLETE +
  smoke-tested** — 10 routes (`/project-get|list|update|update-name|
  rename|share|delete|restore|confirm-upload`, `/render-job-get-status`),
  all inline SQL, regular style; `canEditProject`/`isWorkspaceMember`
  added to services/projectAccess.ts (assert_* parity incl. the
  live-workspace check the Part 1 helper lacked); call sites swapped in
  cloudStorage/Header/useCloudRender. Parity pins landed: conflict-null,
  hash short-circuit bypassing the version check, owner-only share with
  isNew, workspace-deleted 403s. Full HTTP smoke test on a throwaway
  local instance (port 8085): all legs green. 432 tests pass (known
  pre-existing failure only), typechecks + eslint clean (pre-existing
  findings verified on HEAD; one removed). Awaiting user browser
  verification + go-ahead. Details in the 2-2 prompt's status.
- 2026-07-24 — **PIVOT 2 (user decision): regular routes, hard cutover.**
  No RPC-specific style anywhere: kebab-case flat routes one-module-per-
  endpoint (Part 1 conventions), client-shaped camelCase
  requests/responses, existing `invokeFunction` client. The
  registry/flag/fallback wrapper (`webapp/src/api/rpc.ts`,
  `MIGRATED_RPCS`, `VITE_USE_SERVER_RPC`) DELETED — client+server ship
  together per batch; rollback = git revert (accepted: low usage). Batch
  1 reworked again (`/asset-list`, `/asset-delete`); Batch 2 prompt
  updated.
- 2026-07-25 — **Shared contract Step 1 landed** (design + steps in
  `plans/shared-api-contract.md`): `shared/api/{assets,projects,
  renderJobs,index}.ts` now hold the TypeBox request/response schemas
  the 12 Part 2 routes validate with (imported as `@shared/api/*` —
  tsconfig paths + tsup alias/noExternal + vitest aliases; server
  tsconfig also gained `"rootDir": ".."` + the include — TS 7
  defaults rootDir to the tsconfig dir) and the `ApiRoutes` map typing
  `invokeFunction`; all Part 2 call sites dropped their inline
  generics. The contract immediately caught TWO phantom-field reads:
  Header's dead `share_slug` (fixed → `data.slug`, shareSlug now
  auto-populates on editor open) and cloudProjectService's
  `cloudProject.user_id` (never returned by project-get — the pre-v5
  storagePath backfill built `undefined/…` paths; fixed → `created_by`).
  Checks: both typechecks clean, 432 tests + known failure, eslint no
  new findings (−2 in cloudStorage), tsup build green, tsx boot smoke
  on port 8086 green. ⚠ Deploy note: the Railway service builds with
  root directory `server/` — if Railway isolates the build context to
  that directory, `../shared/api` won't exist at build time and tsup
  fails loudly at deploy; fix = widen the root dir (build
  `cd server && npm ci && npm run build`) or a small Dockerfile à la
  render-worker. Verify on the next deploy. Batch 3 (workspaces) routes
  will be born typed.
- 2026-07-25 — **Batches 3+4 merged into one prompt** (user decision):
  `plans/fastify-part2-3-workspaces-session-rpc-migration-prompt.md` —
  14 routes (11 workspace + user-profile-get / workspace-get-default /
  subscription-get), born typed via shared/api. Decisions folded in:
  **trial_start killed** (no callers; graveyard; expires_at loses its
  last clearer), `/send-welcome-email` kept despite becoming
  caller-less, workspace_delete gets no route (zero callers,
  graveyard candidate), user_profile_create stays (signup trigger).
  Scoping found a LIVE bug the port fixes: workspace_get's
  pending-invitations list is always empty (expires_at filter vs the
  no-expiry migration — see suggested_changes). After this batch,
  `.rpc(` is gone from webapp/src and the graveyard sweep gets
  planned. Awaiting go-ahead to implement.
- 2026-07-25 — **Batches 3+4 CODE COMPLETE + smoke-tested** — all 14
  workspace/session routes landed born-typed (details in the 2-3
  prompt's status). `.rpc(` count in webapp/src is ZERO; supabase-js
  now serves only auth/session + TUS uploads — the Part 2 exit
  criteria. The workspace_get pending-invitations live bug is fixed on
  the ported path (pinned + observed live). 70 new tests (502 total
  passing + the known failure); typechecks/eslint/build clean.
  Awaiting user browser verification + go-ahead; then the graveyard
  sweep is the last Part 2 step.
- 2026-07-25 — **GRAVEYARD SWEEP DONE (repo-side) — Part 2 is
  code-complete end to end.** All 36 orphaned public fns dropped:
  the 26 migrated RPCs, trial_start (killed), 5 zero-caller orphans
  found by the audit (workspace_delete, project_create v1,
  project_editor_add/_remove, project_move_to_workspace), the 4
  assert_* helpers (last callers died with the RPCs), plus a stray
  6-arg render_job_start overload two older graveyard entries missed
  by signature. DROP signatures generated from pg_proc (no overload
  misses). sql/functions/ now holds exactly the 5 keepers:
  mux_video_complete, mux_video_get_or_create, render_job_complete,
  render_job_get_or_create, user_profile_create. Applied LOCALLY via
  sql/deploy.sh; full suite re-run against the swept db: 502 passed +
  the known failure — nothing depended on the dropped fns.
  **Remaining (user, in order): browser click-through of Batches 3+4 →
  commit/push → prod deploy of server+webapp (verify the Railway
  build-context note) → `sql/deploy.sh --remote` LAST** (the frozen
  fns must outlive any stale prod bundle; the graveyard header
  documents the order).
