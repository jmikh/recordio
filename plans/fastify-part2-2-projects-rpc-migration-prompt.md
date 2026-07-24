# Prompt: Part 2 Batch 2 — Projects + render-status routes (inline SQL ports)

Read FIRST, in order: `plans/fastify-part2-rpc-proxy-migration.md` (the
design — inline ports, **regular routes**, hard cutover, DoD),
`plans/fastify-part2-1-assets-rpc-migration.md` (the executed pilot — its
status section records the conventions this batch reuses), and the agent
instructions at the top of `plans/suggested_changes.md`.

## Context (as of 2026-07-24, after both pivots)

- **Approach: each SQL function becomes a REGULAR route** —
  indistinguishable from the Part 1 routes. Kebab-case top-level path,
  one camelCase module per route in `server/src/routes/`, inline SQL over
  `app.deps.db` with the verified `req.user.id` as an explicit bind param
  (no `auth.uid()`, no claims injection, no `/rpc` prefix — all that
  machinery was built and deleted; git history).
- **Hard cutover:** client call sites swap to the existing
  `invokeFunction(name, body)` in the SAME change; no registry, no flag,
  no `supabase.rpc` fallback. Rollback = git revert + redeploy (the SQL
  functions stay deployed and FROZEN until the Part 2 end sweep; never
  edit them).
- Pilot live and user-verified: `/asset-list` + `/asset-delete`
  (`routes/assetList.ts`, `assetDelete.ts`) — copy their shape: strict
  TypeBox request AND response schemas, client-shaped camelCase bodies,
  object-wrapped responses, SQL column aliasing (`AS "camelCase"`),
  `to_jsonb(timestamptz)` / `bigint::int` casts.
- Check the deploy state before starting (nothing committed/pushed as of
  this prompt) — coordinate commit/push with the user.

## Scope: 10 SQL functions → 10 routes

| SQL fn | route | request body | response |
|---|---|---|---|
| `project_get(p_project_id)` jsonb | `/project-get` | `{ projectId }` | the project jsonb (see shape rule) |
| `project_list(p_workspace_id)` jsonb | `/project-list` | `{ workspaceId }` | the list jsonb (see shape rule) |
| `project_update(p_project_id, p_project_data, p_duration_ms, p_expected_version)` int | `/project-update` | `{ projectId, projectData, durationMs, expectedVersion }` | `{ cloudVersion: number \| null }` — **null = version conflict** |
| `project_update_name(...)` void | `/project-update-name` | `{ projectId, name }` | `{}` or `{ ok: true }` |
| `project_rename(...)` void | `/project-rename` | `{ projectId, name }` | ditto |
| `project_share(p_project_id, p_share_policy)` TABLE(slug, is_new) | `/project-share` | `{ projectId, sharePolicy? }` | `{ slug, isNew }` — a single object; the TABLE wrapper was an RPC artifact |
| `project_restore(...)` bool | `/project-restore` | `{ projectId }` | `{ restored: boolean }` (or match what the call site checks) |
| `project_delete(...)` bool | `/project-delete` | `{ projectId }` | ditto pattern |
| `project_confirm_upload(...)` bool | `/project-confirm-upload` | `{ projectId }` | ditto pattern |
| `render_job_get_status(p_job_id)` jsonb | `/render-job-get-status` | `{ jobId }` | the status jsonb (see shape rule) |

**Response-shape rule:** request bodies are always camelCase. For
responses, reshape to camelCase client-shaped objects where cheap (the
scalar/void/small ones above); for the big jsonb-blob responses
(project-get, project-list, render-job-get-status) KEEP the field shape
the client already consumes — renaming every field of a project row is
churn without value (log it in suggested_changes as a later option).
Audit each call site for exactly which fields it reads and pin those.

Re-grep call sites before starting (`\.rpc\('` in webapp/src) — line
numbers in this prompt may have shifted.

## Porting rules (per fn, in order)

1. **Read the SQL source** (`supabase/sql/functions/<fn>.sql`) — access
   rule (owner vs editor vs workspace member), NULL semantics, exact
   return shape, side effects, any RAISE. project_list/project_get were
   just edited by the folders/starred deprecation — port the CURRENT
   version.
2. Port access checks as explicit SQL (`WHERE owner_id = $user` / joins)
   or reuse `server/src/services/projectAccess.ts` where its semantics
   MATCH (verify per fn — don't force it).
3. Business-rule RAISEs whose message a call site reads → a typed error
   field in the response body (the Part 1 `library_full` pattern), or a
   4xx with a typed body — whatever the audited call site needs. Errors
   nothing reads → Fastify defaults.
4. Prefer single statements (UPDATE … RETURNING, one SELECT with joins)
   over sequential queries.
5. One route module per endpoint + one test file per route (Part 1
   convention), registered flat in app.ts.

## Load-bearing parity points (each gets a pinning test)

1. **`project_update` conflict** — `cloudStorage.saveProjectMetadata`
   maps a null result → `CloudVersionConflictError` (~line 76); the
   editor's whole conflict flow keys off it. Port the compare-and-set
   exactly (likely `UPDATE … WHERE cloud_version = p_expected_version
   RETURNING`); route returns `{ cloudVersion: null }` on mismatch; e2e:
   stale version → null + row unchanged; fresh → new int + row updated.
   Update the call site to read `data.cloudVersion`.
2. **`project_share`** — Header.tsx consumed it via `.single()`; with a
   client-shaped `{ slug, isNew }` response the call site simplifies
   (drop `.single()`, drop the cast). The call site omits the share
   policy today — mirror the SQL default explicitly (schema optional +
   route default). Port the slug generation faithfully (read the fn —
   generate-on-first-share vs return-existing; `isNew` distinguishes).
3. **Header's `project_get` ignores errors** (`.then(({ data }) =>`, no
   catch) — `invokeFunction` always resolves `{ data, error }`; keep the
   swap shape so this stays safe.
4. **`render_job_get_status` polls on an interval** during renders —
   after cutover watch the request rate in Railway logs; global 300/min
   backstop applies.

## Tests + client mechanics (the pilot's pattern)

- Per route test file (`server/test/projectGet.test.ts`, …): 401 +
  schema-400 pre-query via throwing db; e2e on real Postgres — happy
  path, authz denials (other-user token; editor-vs-owner where the SQL
  distinguishes), DB-state assertions for every mutating fn, the parity
  pins, canonical log fields (`project.id` / `render.job_id`). Seed
  helpers exist (`seedProject`, `seedRenderJob`, `seedProjectEditor`,
  `deleteProjects`; render_jobs cascade). Unique rows + targeted
  deletes; containment assertions where seeded users are shared with
  parallel suites.
- Client: swap each call site to `invokeFunction`; drop `if (!supabase)`
  guards only where the import then dies. cloudProjectService.test.ts
  mocks CloudStorage so it should be untouched — verify.
- Out-of-scope finds → one bullet in `plans/suggested_changes.md`, never
  fixed inline.

## Checks + gate (do not skip)

- Root `npx vitest run server webapp/src` — only acceptable failure: the
  known pre-existing cloudProjectService "passes expected version"
  expectation.
- `server`: `npm run typecheck`; `webapp`: `tsc -b`; eslint on changed
  files (verify any finding on HEAD before dismissing it).
- Local HTTP smoke test against the running local server (port **8080** —
  8090 is the render worker; real password-grant token, the pilot's
  pattern — and RESTART the server first if it predates your changes,
  tsx runs without watch): at least project-list, project-update happy +
  conflict, project-share twice (isNew true then false). Clean up seeded
  rows.
- Then STOP: user browser click-through (editor open/save/rename/share/
  delete/restore + a render poll), go-ahead, commit/push + prod-deploy
  timing is the user's. Update the status sections of the parent doc and
  this file with what landed.
