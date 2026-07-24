# Shared API Contract — TypeBox schemas as the client↔server source of truth

Why: today the contract is enforced server-side (TypeBox request schemas,
Ajv) but the webapp's knowledge of it is inline generic assertions per
call site (`invokeFunction<{ slug: string; isNew: boolean }>(...)`) and
hand-maintained mirror types (`CloudProject`). A server-side rename
compiles clean everywhere and fails at runtime — the Header `share_slug`
dead read (suggested_changes) is the live specimen of this bug class.
TypeBox schemas are plain values whose TS types derive via `Static<>`,
so exporting them from `shared/` gives the webapp compile-time types
from the very objects the server enforces at runtime — no codegen.

## Field-change semantics (what the contract does and doesn't cover)

- **Backend adds a field:** safe, always. Clients ignore unknown fields.
  Caveat: on routes WITH a response schema, Fastify's serializer STRIPS
  fields not in the schema — so "adding a field" means adding it to the
  (now shared) response schema, which is exactly where the client's type
  picks it up.
- **Backend removes/renames a field:** NOT silently fine. Client reads
  become `undefined` (not null) — conditionals go quietly falsy, the
  Header-`share_slug` failure mode. WITH the shared contract, the
  removal changes the shared type and every webapp read site becomes a
  compile error — that is the point of this plan.
- **What types can't do:** runtime guarantees across deploy skew. An
  already-open tab runs yesterday's bundle against today's server.
  Additive changes are safe under skew; removals/renames are breaking
  and should either be staged (client stops reading → later the server
  stops sending) or accepted as a refresh-fixes-it blip (consistent
  with the low-usage hard-cutover posture). No response-side runtime
  validation is added by this plan (deliberate — the server's request
  validation stays the runtime enforcement).

## Design

- **`shared/api/`** (new; `shared/` is already aliased as `@shared` in
  webapp vite/tsconfig and the root vitest config):
  - Per-domain contract files: `assets.ts`, `projects.ts`,
    `renderJobs.ts` (Batch 3+ adds `workspaces.ts`, `session.ts`).
    Each exports the TypeBox **request schemas** (moved verbatim from
    the route files) and **response schemas** where the server enforces
    one, plus `Static<>`-derived types.
  - Blob responses the server deliberately does NOT schema-validate
    (project-get, project-list rows) are **plain interfaces**, not
    TypeBox — no pretend-validation. `CloudProject` and
    `CloudProjectSummary` MOVE here from `webapp/src/storage/
    cloudStorage.ts` (they ARE the contract for those routes).
  - `shared/api/index.ts`: the route map — compile-time only:
    `interface ApiRoutes { 'asset-list': { request: AssetListRequest;
    response: AssetListResponse }; ... }`.
  - Rule: `shared/api` imports nothing from server/ or webapp/ — pure
    schemas/types + `@sinclair/typebox`.
- **Dependencies:** add `@sinclair/typebox` to the ROOT package.json
  (webapp deps live there; no workspaces). Keep the same minor as
  `server/package.json` (`^0.34`) — schemas are plain objects, but
  `Static<>` inference should come from one version.
- **Server:** route files import their schemas as `@shared/api/assets`
  etc. — the same `@shared/*` spelling the webapp and render-worker use
  (user decision 2026-07-25; started as relative paths). Each resolver
  is configured once: tsconfig `paths` (tsx honors it natively), a tsup
  esbuild alias + `noExternal: [/^@shared\//]` (bare specifiers are
  otherwise externalized; render-worker precedent), and a vitest alias
  in server/vitest.config.ts (the root config already had one). Also
  `"../shared/api"` in tsconfig `include` + `"rootDir": ".."` so
  typecheck covers it. Validation behavior unchanged (same objects).
- **Client:** type the existing chokepoint, change nothing else:
  ```ts
  // api/client.ts — overloads
  export async function invokeFunction<K extends keyof ApiRoutes>(
      name: K, body: ApiRoutes[K]['request'],
  ): Promise<InvokeResult<ApiRoutes[K]['response']>>;
  export async function invokeFunction<T = unknown>(   // fallback for
      name: string, body?: unknown,                    // unmapped routes
  ): Promise<InvokeResult<T>>;
  ```
  Call sites on mapped routes drop their inline generics and get
  typo-checked bodies. `invokeFunctionUpload` (FormData) keeps its own
  signature — multipart bodies aren't schema-typed.

## Steps

1. **Infra + Part 2 routes (12):** root dep; `shared/api/{assets,
   projects,renderJobs}.ts` + `index.ts`; move `CloudProject`/
   `CloudProjectSummary` (webapp imports update — keep a re-export from
   cloudStorage.ts if churn is wide); server routes import shared
   schemas; typed `invokeFunction` overload; delete inline generics at
   the Part 2 call sites. Checks: full vitest + both typechecks prove
   the contract holds (the compiler IS the test here — no new runtime
   tests needed; existing route tests keep pinning runtime behavior).
2. **Backfill Part 1 routes** (~10 mapped names: storage-download-urls,
   mux-video-create, transcribe, stripe-checkout/portal/
   subscription-change, project-create-v2, shared-video-get, …): author
   their contract files from the existing route schemas, extend
   ApiRoutes, drop those call sites' generics.
3. **Close the map:** remove the untyped fallback overload so an
   unmapped route name is a compile error — the registry becomes
   exhaustive and stays that way (new routes MUST land in shared/api;
   Part 2 parent-plan DoD updated accordingly).

Steps 2–3 can trail Batch 3 — but Step 1 lands BEFORE Batch 3 so the
next ~14 routes are born typed instead of retrofitted.

## Contract evolution + deploy skew (policy)

How contract changes ship, in escalating order — global `/v2` API
versioning is deliberately NOT on this ladder (it exists for consumers
you can't update; ours is one first-party webapp shipped from this repo):

1. **Additive** (new field / optional param) → just ship; safe under any
   skew. On schema'd routes, "adding a field" = adding it to the shared
   response schema (the serializer strips undeclared fields).
2. **Breaking but stageable** (rename / semantic change) →
   expand-contract: serve both shapes → migrate the client → drop the
   old shape a deploy later (the `cancel_at` migration pattern).
3. **Incompatible reshape** → a per-ROUTE `-v2` name (the
   `project-create-v2` precedent); delete the old route when its
   traffic reads zero in Railway logs. Never a global version prefix.
4. Revisit only if an uncontrolled consumer appears (e.g. the browser
   extension ever calling the server directly — today it bridges
   through the webapp).

A stale-bundle reload nudge (the systemic fix for tab skew) is logged
in `plans/suggested_changes.md` (2026-07-25) rather than being a step
of this plan — it's independent post-Step-1 work.

## Out of scope

- Runtime response validation client-side (types only, stated above).
- OpenAPI generation / tRPC — the schemas being real JSON Schema keeps
  the OpenAPI door open later at zero cost.
- Render-worker / webhook / cron routes — no browser client, no shared
  contract needed.

## Status

- 2026-07-25 — planned. Sequencing: Step 1 before Part 2 Batch 3.
- 2026-07-25 — the optional stale-bundle reload nudge (was "Step 4")
  moved to `plans/suggested_changes.md` (user decision) — independent
  post-Step-1 work, not a step of this plan.
- 2026-07-25 — **Step 1 DONE.** Deltas from the design as written:
  - `@sinclair/typebox@^0.34.52` added to root package.json (matches
    server's minor).
  - Server tsconfig ALSO needed `"rootDir": ".."` — TypeScript 7
    defaults rootDir to the tsconfig directory, so including
    `../shared/api` trips TS6059 without it (noEmit: layout is
    typecheck-only; tsup does the real build and bundles shared/api —
    verified with `npm run build` + a tsx boot smoke on port 8086).
  - No re-export shim kept in cloudStorage.ts: exactly one importer
    (cloudProjectService) — updated directly. `CloudProject`/
    `CloudProjectSummary` now mirror the routes' jsonb_build_object
    field lists EXACTLY (the old webapp copies were both missing fields
    and carrying a phantom one, see next).
  - The compiler paid for itself on day one — two phantom-field reads
    became compile errors and were fixed: Header's `data?.share_slug`
    (the suggested_changes specimen → `data.slug`; shareSlug now
    auto-populates on editor open, so the button reads
    Republish/copy-enabled for already-shared projects) and
    cloudProjectService's `cloudProject.user_id` (project-get never
    returned it — the pre-v5 storagePath backfill was building
    `undefined/…` paths; → `created_by`, the media-path prefix
    convention).
  - The identical-twin routes (project-update-name / project-rename)
    share one schema pair (`ProjectNameUpdateRequest/Response`); the
    four bare `{ projectId }` bodies share `ProjectIdRequestSchema`.
  - asset-list's response row `assetType` narrowed from `Type.String()`
    to the background|music literal union (the route's WHERE clause
    guarantees it; pinned by the existing route tests).
  - Checks: server typecheck + webapp `tsc -b` clean; 432 tests pass
    (only the known pre-existing cloudProjectService failure; its
    summary fixture gained the 4 new fields); eslint — zero findings in
    changed/new files beyond HEAD (2 pre-existing `any`s died with the
    moved interface).
  - ⚠ Open deploy question (also in the Part 2 plan status): Railway
    builds the server with root directory `server/` — if that isolates
    the build context, `../shared/api` is missing at build time and
    tsup fails loudly on the next deploy. Fix: widen the root dir
    (build: `cd server && npm ci && npm run build`) or a render-worker
    style Dockerfile. Verify at the next server deploy.
  - Steps 2–3 remain (Part 1 backfill; close the map).
- 2026-07-25 — **server switched to `@shared/*` imports** (user
  decision; Design → Server updated above). Verified end to end:
  typecheck, tsup build, server-local vitest (alias added to its
  config), root vitest with DB, tsx boot smoke (port 8087). Note:
  server-local `npm run test` skips the e2e suites (its vitest config
  never loaded `.env.test` — pre-existing; root vitest is the one that
  runs them).
