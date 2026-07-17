# Part 11 prompt — Wave B #8: transcribe

Continue the Supabase → Fastify migration. Read
`plans/fastify-part1-edge-functions-migration.md` first — its "Status"
section is the source of truth. Done so far: Steps 0–3, all of Wave A,
and Wave B #7 (asset-create), #12 (project-create-v2), #10
(render-job-create) — all user-verified. The prod-webapp flag flip stays
deferred to the END of the migration. Also read
`plans/suggested_changes.md` and ADD any new findings there.

Your task: **transcribe** only — the last plain client-invoked route.
Do not start #9 (mux-video-create) until I explicitly say go.

Flow: `{ projectId }` → project lookup → workspace-membership +
subscription gate → mic-audio download from S3 → OpenAI Whisper →
word-level caption segments. First real TranscriptionPort adapter and
first route calling an external AI API. **One new REQUIRED env var:
`OPENAI_API_KEY`** (required in config.ts per the repo rule — no
optional-with-degrade; add to `server/.env.example`; Railway needs it
before deploy. The value is in the Supabase edge-function secrets).

1. Read `supabase/functions/transcribe/index.ts`.
   **DB-function classification: `subscription_get(p_workspace_id)` is
   SHARED and auth.uid()-dependent** — the webapp calls it directly
   (AuthManager login, BillingPage poll, switchWorkspace), so the SQL
   function stays untouched; and because it reads `auth.uid()` it cannot
   work over the pg pool → port its logic INLINE with explicit
   `$user_id`. **SECURITY-CRITICAL:** its `workspace_members` JOIN is
   the ONLY access control on this endpoint (there is no editor/owner
   check — the gate is "caller is a member of the project's workspace
   AND that workspace has an active|trialing subscription"). The inline
   port must keep the membership join:
   ```sql
   SELECT s.status FROM subscriptions s
   JOIN workspace_members wm
     ON wm.workspace_id = s.workspace_id AND wm.user_id = $2
   WHERE s.workspace_id = $1
   ```
   Non-member, no-subscription-row, and wrong-status all collapse to the
   same 403 `Active subscription required` (edge-fn parity — the RPC
   returned NULL for the first two; information hiding).
   Check order parity: project lookup (`project_data, workspace_id`
   where `deleted_at IS NULL` → 404 `Project not found`) → subscription
   gate (403) → mic path (400 `Project has no microphone audio`) → S3 →
   Whisper. Write the analysis paragraph as in previous waves.

2. Adapter `server/src/adapters/transcription.ts` (first
   TranscriptionPort adapter): **raw fetch, no `openai` npm package** —
   Node 22 has native FormData/File/Blob. POST
   `https://api.openai.com/v1/audio/transcriptions` with bearer
   `OPENAI_API_KEY`; multipart fields exactly as the edge fn sent them:
   `model=whisper-1`, `response_format=verbose_json`,
   `timestamp_granularities[]` = `segment` AND `word` (two entries),
   the file, and the exact prompt string ("This is a clear,
   professional recording…" — copy verbatim). Map the response into
   `TranscriptionResult` (`words[]` word/start/end seconds,
   `segments[]` text/start/end seconds — the port already defines it;
   seconds→ms conversion is route logic). Throw on non-2xx with status
   + a body snippet (never echo the key). **Server-side timeout
   (documented addition, plan requirement):** `AbortSignal.timeout` at
   ~120 s — Railway has no request ceiling and Whisper on long audio
   can hang; the edge runtime's own wall clock was ~150 s so nothing
   regresses. Wire in `server.ts` (replaces
   `unimplementedPort('transcription')`).

3. Port as `server/src/routes/transcribe.ts`: `requireUser`; schema
   `{ projectId: Type.String({ minLength: 1 }) }` (schema 400 replaces
   the edge fn's `Missing projectId` body — same divergence as all
   waves); response 200
   `{ segments: [{ sourceStartTimeMs, sourceEndTimeMs, words: [{ word,
   sourceStartTimeMs, sourceEndTimeMs }] }] }`, 400/500 with
   `additionalProperties: true`, 403/404 exact bodies. Mic path: add a
   `getProjectMicPath` export to the existing
   `src/services/projectMedia.ts` (don't duplicate). Audio download via
   `S3Port.getObject` (already implemented) — the edge fn's
   `S3_ENDPOINT_DEV`-first split is a Docker artifact, dropped (this is
   a server-side download, the host reaches S3_ENDPOINT directly).
   Extension → mime map copied exactly (webm/wav/mp3/ogg/m4a/flac,
   default `audio/wav`; ext = `micPath.split('.').pop() ?? 'wav'`,
   fileName `audio.${ext}`). Port the pure post-processing byte-exact
   as EXPORTED route-module helpers (so they unit-test directly):
   `addPunctuationFromSegments` (token-merge heuristic — copy verbatim,
   quirks and all), seconds→ms `Math.round`, the ±50 ms window grouping
   that drops words outside every segment window, empty `words` →
   `{ segments: [] }` short-circuit. Log fields: `project.id` +
   `storage.bytes` (audio byte length) — both already exist in
   `DomainLogFields`.

4. Tests — e2e real Postgres + fakeS3 (seed the mic object bytes) +
   fakeTranscription (seedable `result`, records
   fileName/mimeType/byteLength). **Test-workspace gotcha:** the
   subscriptions pkey is `workspace_id` and the seeded users' personal
   workspaces are SHARED across parallel suites — never attach a
   subscription to them. Extend `seedProject` with an optional
   `workspaceId` (like `projectData` was added) and build each test's
   chain explicitly: `seedWorkspace` → `seedWorkspaceMember` →
   `seedSubscription` → `seedProject({ workspaceId })`. Matrix: 401
   no/garbage token; schema 400 missing/empty projectId (throwing db);
   404 unknown + soft-deleted project; **403 non-member** — the
   project lives in user2's workspace, caller user1 has their own
   active subscription elsewhere (the security-critical test: proves
   the membership join survived the inline port); 403 member but no
   subscription row; 403 member with `canceled` and with `past_due`
   status (note: past_due is NOT accepted here, unlike
   project-create-v2's expiry check — flag the inconsistency, don't
   fix); 400 exact body when project_data has no mic path; on every
   reject path assert NO S3 read and NO transcription call
   (`fake.requests` empty). Success: seed a custom fakeTranscription
   result that exercises the merge — words needing punctuation
   restored from segment text, a word outside every segment window
   (dropped), rounding of fractional seconds — and assert the EXACT
   segments output; ext mapping (a `.webm` mic → mimeType audio/webm,
   fileName audio.webm); `{ segments: [] }` when the result has no
   words; canonical log fields. Plus pure unit tests for
   `addPunctuationFromSegments` and the grouping helper (no HTTP).
   Optional third-party tier: `test/adapters/transcription.integration.test.ts`
   guarded on `OPENAI_API_KEY` being set (same pattern as the Stripe
   `sk_test_` guard) with a tiny generated WAV — shape asserts only.

5. Client (`webapp/src/editor/transcription/CloudTranscriptionService.ts`):
   convert the invoke to `invokeFunction<{ segments: … }>` and register
   `'transcribe'` in MIGRATED_FUNCTIONS (`webapp/src/api/client.ts`).
   The local-Whisper worker path (`TranscriptionService.ts`,
   `transcription.worker.ts`) is NOT this function — don't touch it.

6. Run: root `npx vitest run server webapp/src/api`, server
   `npm run typecheck`, webapp `npx tsc -b`, eslint on changed files.
   Update the plan's Status (done entry + analysis + next:
   mux-video-create) and add findings to `plans/suggested_changes.md` —
   candidates spotted at prompt time: no per-user rate limit on an
   expensive AI endpoint (only the global 300/min backstop); the whole
   audio file is buffered in memory per request (a long WAV is large);
   no dedup/in-flight lock — double-trigger = two Whisper bills;
   active|trialing here vs active|past_due in project-create-v2.
   Then PAUSE for my verification (local webapp flag-on: generate
   captions in the editor on a project with mic audio, confirm
   segments/timings look right; then against Railway after deploy —
   set OPENAI_API_KEY there first).

Conventions & gotchas: `server/README.md` governs (ports/fakes, no
console.*, response schemas, level policy). Nothing is ever deleted
from Supabase. Root `.env.test` is committed on purpose. CI runs the
root vitest config with `supabase start` backgrounded + `sql/deploy.sh`
(added in part 10). Ajv coercion is ON — numeric strings coerce (see
suggested_changes). No stashing for inspection — use
`git show HEAD:path`. Debug before fixing. Use build:extension:dev,
never build:extension. Known pre-existing failures, not yours:
cloudProjectService.test.ts "passes expected version to CloudStorage";
VideoPage.tsx 3 react-hooks eslint findings; StripeService.ts 2
`no-explicit-any`; cloudStorage.ts `project_data: any`;
useCloudRender.ts 6 `no-explicit-any`.
