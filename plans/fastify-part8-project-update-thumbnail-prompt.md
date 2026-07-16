# Part 8 prompt — Wave A #6: project-update-thumbnail

Continue the Supabase → Fastify migration. Read
`plans/fastify-part1-edge-functions-migration.md` first — its "Status"
section is the source of truth. Done so far: Steps 0–3 and Wave A
#1–#3 (storage-download-urls, shared-video-get, and all three Stripe
routes) — all user-verified. `unsubscribe` was punted to Wave E (user
decision 2026-07-16). The prod-webapp flag flip stays deferred to the
END of the migration. Also read `plans/suggested_changes.md` and ADD
any new findings there.

Your task: **project-update-thumbnail** only — the last Wave A route.
Do not start Wave B until I explicitly say go.

New pattern elements (firsts for the server):

- **First multipart route.** The edge fn takes `multipart/form-data`
  (`projectId` + `file`, an image/webp blob). Add `@fastify/multipart`
  (new dependency). TypeBox body schemas don't apply to multipart —
  field presence is checked in the handler; keep the exact 400 body
  `{ error: 'Missing projectId or file' }`. Size cap 500 KB → 413 with
  the exact interpolated body
  `Thumbnail too large: <n> bytes (max 512000)` — note
  @fastify/multipart's own fileSize limit produces Fastify's default
  413 body, so either set its limit above 500 KB and enforce the cap
  manually for body parity, or accept the default-body divergence and
  document it (no call site reads the body — client throws generically).
- **First direct server-side S3 upload.** `S3Port.putObject` already
  exists (real adapter + fake + integration test — verified against the
  local stack in Wave A #1). Key: `${userId}/${projectId}/thumbnail.webp`,
  ContentType hardcoded `image/webp` (edge fn does this regardless of
  the actual blob type — parity; record as a smell, don't fix). The
  edge fn's `S3_ENDPOINT_DEV` fallback exists only because the edge
  runtime runs inside Docker — the Fastify server runs on the host, so
  plain `S3_ENDPOINT` works. **No new env vars**; Railway already has
  the four S3_* vars.
- **First ported `_shared` helper with future consumers.**
  `getProjectIfEditor` (`supabase/functions/_shared/projectAccess.ts`)
  is shared with `mux-video-create` and `render-job-create` (both
  Wave B). Port it as the first shared server module —
  `src/services/projectAccess.ts`, a plain function taking the Db port
  (this is the services convention noted in suggested_changes.md; its
  first justified use). The Deno copy stays for the two unmigrated edge
  fns (standard temporary duplication per Step 2). Semantics to
  preserve: project by id AND `deleted_at IS NULL`; owner_id match →
  access; else an explicit `project_editors` row → access; else null.
  The edge fn's two queries can collapse to one
  (`owner_id = $2 OR EXISTS (SELECT 1 FROM project_editors …)`) —
  parity-safe because "not found" and "no access" both return null →
  the same 404. Keep the `extraSelect` idea only if trivially typed;
  the thumbnail route needs just id/owner_id — don't over-generalize
  for Wave B before Wave B lands.

1. Read `supabase/functions/project-update-thumbnail/index.ts`.
   **DB-function classification: none called** — direct table
   reads/update (`projects`, `project_editors`) with the service-role
   client; over the pg pool it's plain SQL. Flow: multipart parse →
   400/413 checks → editor-access check → 404
   `{ error: 'Project not found or access denied' }` → S3 put → update
   `projects.thumbnail_storage_path` → `{ storagePath }`. Write the
   analysis paragraph as in previous waves. Smells to record: S3 put
   then DB update is not atomic (a crash between leaves an orphan S3
   object — harmless, the path is deterministic and overwritten next
   time); ContentType hardcoded regardless of blob type; the file's
   actual content is never validated as webp/an image.

2. Port as `server/src/routes/projectUpdateThumbnail.ts`:
   `requireUser`; response schema for 200 `{ storagePath }` (and
   declared codes you explicitly send — see the subscription-change
   entry for the additionalProperties trick if needed); `project.id`
   already exists in `DomainLogFields`; consider contributing the
   upload size (e.g. a `storage.bytes` field — add to DomainLogFields
   if you do).

3. Tests: HAS DB access → e2e via `app.inject` + real local Postgres
   (`describe.runIf(hasTestDb())`, pool in `beforeAll`), fakeS3 for
   storage. Multipart injection: Node's global `FormData` +
   `app.inject({ payload })` — verify what light-my-request supports in
   our version and build the multipart body accordingly (a small local
   helper is fine). Seed builders: `seedProject` exists; add
   `seedProjectEditor` (project_editors row) to `test/helpers/db.ts`.
   Matrix: 401 no/garbage token; 400 missing projectId / missing file
   (exact body); 413 over 500 KB (assert no S3 put and no DB change);
   404 unknown project / soft-deleted project / authed non-owner
   non-editor (assert no S3 put); 200 owner → fakeS3 recorded the key,
   bytes and content type, `thumbnail_storage_path` updated, response
   `{ storagePath }`; 200 explicit project_editors editor (owned by
   SEEDED_USER_2_ID, caller SEEDED_USER_ID with an editors row);
   overwrite: second upload for the same project succeeds and the path
   is unchanged; canonical log fields; DB unchanged on every failure
   path.

4. Client (`webapp/src/storage/cloudStorage.ts:uploadThumbnail`):
   convert to `invokeFunction` and register `'project-update-thumbnail'`
   in MIGRATED_FUNCTIONS. **The wrapper must learn FormData:**
   `invokeFunction` currently JSON.stringifies every body and sets
   `Content-Type: application/json` — for a `FormData` body it must
   pass it through untouched and NOT set Content-Type (the browser sets
   the multipart boundary). `supabase.functions.invoke` already handles
   FormData natively, so the fall-through path needs no change. Add
   `webapp/src/api/client.test.ts` coverage for the FormData path
   (headers, body passthrough, no JSON content-type).

5. Run: root `npx vitest run server webapp/src/api`, server
   `npm run typecheck`, webapp `npx tsc -b`, eslint on changed files.
   Update the plan's Status (done entry + analysis + next: Wave A
   complete → Wave B on explicit go) and add findings to
   `plans/suggested_changes.md`, then PAUSE for my verification (local
   webapp flag-on: trigger a thumbnail update — it fires on project
   save from the editor — and check the new webp lands in storage and
   the projects row points at it; then against Railway after deploy).

Conventions & gotchas: `server/README.md` governs (ports/fakes, no
console.*, response schemas, level policy). Nothing is ever deleted
from Supabase. Root `.env.test` is committed on purpose. CI runs the
root vitest config with `supabase start` backgrounded. Railway
DATABASE_URL uses the direct IPv6 connection — see README before
touching db config. Debug before fixing — reproduce or add logs before
guessing. Use build:extension:dev, never build:extension. Known
pre-existing failures, not yours: cloudProjectService.test.ts "passes
expected version to CloudStorage"; VideoPage.tsx's 3 react-hooks
eslint findings; StripeService.ts has 2 pre-existing `no-explicit-any`
eslint findings.
