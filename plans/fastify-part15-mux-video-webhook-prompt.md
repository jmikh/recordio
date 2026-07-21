# Part 15 prompt — Wave D #16: mux-video-hook → /mux-video-webhook

Continue the Supabase → Fastify migration. Read
`plans/fastify-part1-edge-functions-migration.md` first — its "Status"
section is the source of truth. Done so far: Steps 0–3, Waves A + B +
C and Wave D #15 — all user-verified. The prod-webapp flag flip stays
deferred to the END. Also read `plans/suggested_changes.md` and ADD
any new findings there.

Your task: **mux-video-hook** only (server route/path
`/mux-video-webhook`, per the webhook naming decision). Do not start
stripe-webhooks until I explicitly say go. **One new REQUIRED env
var: `MUX_WEBHOOK_SECRET`** (config.ts, .env.example — see the
cutover step for WHICH secret value; set on Railway BEFORE deploy).
First route with provider signature auth and the first needing RAW
request bytes.

**Cutover is a HARD SWAP (user decision 2026-07-21 — the publish
feature is barely used):** repoint the webhook URL in the Mux
dashboard to `${PUBLIC_URL}/mux-video-webhook` and test along the
way; rollback = repoint back to the edge fn URL. CAREFUL with the
secret: each Mux webhook endpoint has its OWN signing secret — if
editing the existing endpoint's URL keeps its secret, reuse the edge
fn's value; if a new endpoint must be created, `MUX_WEBHOOK_SECRET`
on Railway must be the NEW endpoint's secret. Say so in the
verification instructions.

1. Read `supabase/functions/mux-video-hook/index.ts` and
   `supabase/sql/functions/mux_video_complete.sql`.
   **DB-function classification: `mux_video_complete` is EXCLUSIVE to
   this webhook, explicit params, no auth.uid()** → stays SQL over
   the pool. Behaviors (parity): `mux-signature` header
   `t=<ts>,v1=<hex>`; HMAC-SHA256 over `${timestamp}.${rawBody}`;
   401s for missing header / bad signature. Events: only
   `video.asset.ready` (→ RPC: find row by mux_asset_id — ANY
   status — mark completed + playback id; `found=false` → 200 with a
   message, warn log) and `video.asset.errored` (→ find PENDING row
   by asset id, mark failed with `errors.messages.join('; ')` or
   `Unknown Mux error`; no row → still 200). `asset.ready` without a
   playback id → THROW (500 → Mux retries). Missing `data.id` or an
   unhandled event type → 200 acknowledged (prevents retries).
   Write the analysis paragraph as in previous waves.

2. **FIX THE RE-PUBLISH DEADLOCK (found 2026-07-21; user decision
   2026-07-22 — remove the constraint and the soft-delete machinery
   entirely).** Background: nothing in the codebase ever sets
   `mux_videos.is_deleted = true`, and
   `idx_mux_videos_one_active_completed` (UNIQUE on project_id WHERE
   is_deleted=false AND status='completed') means a second version's
   `asset.ready` violates the index → webhook 500s forever, and the
   purge can never break the tie (candidates must be below the
   highest COMPLETED version; v2 never completes). The user's
   reasoning: purging mux videos is server-side work, not
   client-facing — there's no need for a fast soft-delete flag.
   The fix, all parts:
   - **Migration** (follow `supabase/migrations/CLAUDE.md`: real
     `date -u '+%Y%m%d%H%M%S'` timestamp, sorts last, IF EXISTS):
     DROP INDEX `idx_mux_videos_one_active_completed`, DROP INDEX
     `idx_mux_videos_deleted`, ALTER TABLE mux_videos DROP COLUMN
     `is_deleted`. One concern (mux soft-delete removal). Update the
     `sql/tables/mux_videos.sql` doc. Apply locally
     (`supabase migration up`); the USER applies it to prod (their
     `supabase db push --linked` flow) BEFORE the webhook cutover —
     say so in the verification steps.
   - **Delete `sql/functions/mux_video_purge_candidates.sql`** +
     graveyard `DROP FUNCTION` (user decision — verified exclusive
     to the purge path; the edge mux-video-purge fn that also calls
     it dies at decommission and its cron overlap-run will just error
     harmlessly... actually CHECK: the still-live edge
     `mux-video-purge` cron DOES call this RPC hourly — dropping the
     fn breaks that edge fn NOW. That's ACCEPTABLE (its replacement
     server job is live and verified), but the pg_cron entry
     `mux-video-purge` should be decommissioned in the SAME breath
     (delete `sql/crons/cron_mux_video_purge.sql`, graveyard
     unschedule) rather than left 500ing hourly. Flag this in the
     plan entry as the early decommission it is.
   - **Rewrite `jobs/muxVideosPurgeSuperseded.ts`** to inline SQL,
     same shape as renderJobsPurgeSuperseded (user decision: latest
     completed mux video by cloud_version per project → purge ALL
     lower non-pending versions; LIMIT 50; the `onlyIds` test seam
     stays). The two purge jobs now mirror each other exactly.
   - **Test fallout**: `seedMuxVideo` loses `isDeleted` (and its
     INSERT column); sharedVideoGet's soft-deleted seeds become
     plain completed rows — its "soft-deleted completed" test turns
     into the REAL new-world case: "an older completed row (awaiting
     the daily purge) — the NEWEST completed version wins" (the
     route already orders `status, cloud_version DESC`, so no route
     change; assert that). muxVideosPurgeSuperseded's is_deleted
     seed becomes a plain second completed row (now legal).
   - **The pin that replaces the deadlock pin**: e2e in the webhook
     suite — seed active completed v1 + pending v2 with an asset id
     → fire `asset.ready` for v2 → 200, BOTH rows completed (no
     unique violation), and shared-video-get (existing route) serves
     v2. The daily purge sweeping v1 is already covered by the purge
     suite.

3. Adapter: implement the REAL `verifyWebhookSignature(rawBody,
   signatureHeader)` in `src/adapters/mux.ts`, replacing the
   throwing stub: parse `t=`/`v1=` (return false on bad format —
   documented divergence: the edge fn's separate 401 `Invalid
   signature format` body collapses into `Invalid signature`; Mux
   doesn't read bodies), `node:crypto` createHmac('sha256',
   webhookSecret) over `${t}.${rawBody}`, compare with
   `timingSafeEqual` (documented hardening over the edge fn's `===`;
   same accept/reject behavior). Still throws 'not configured' when
   `webhookSecret` is absent. NO timestamp tolerance check (parity —
   unlimited replay window; log the smell). Unit-test with real
   vectors: compute a valid signature in the test, assert accept;
   tampered body/signature/format → false (extend
   `test/adapters/mux.test.ts` — no HTTP server needed, it's a pure
   function). Wire `webhookSecret: config.MUX_WEBHOOK_SECRET` in
   server.ts.

4. Route `server/src/routes/muxVideoWebhook.ts` — POST
   `/mux-video-webhook`. **Raw body without new dependencies:**
   inside the plugin register a SCOPED content-type parser
   (`app.addContentTypeParser('application/json', { parseAs:
   'string' }, ...)` — Fastify encapsulation keeps it from leaking to
   other routes; add a test proving another route still gets parsed
   JSON). No body schema (the body is the raw string; the edge fn
   validated nothing) — response schemas only: 200
   `{ ok: Type.Literal(true), message: Type.Optional(Type.String()) }`,
   401/500 as usual. Flow: missing `mux-signature` header → 401
   exact body → `deps.mux.verifyWebhookSignature(rawBody, header)` →
   false → 401 `Invalid signature` → JSON.parse the raw body →
   dispatch on event type as in step 1. `updated_at` from
   `deps.clock`. Log fields: `mux.asset_id`, `mux.video_status`
   (completed/failed), `project.id` (the RPC returns it on ready).
   Register in app.ts (no options beyond deps).

5. Tests — e2e real Postgres + fakeMux (`FAKE_MUX_SIGNATURE` drives
   the fake's verify; override capture proves the EXACT raw string
   reaches it) in `test/muxVideoWebhook.test.ts`: 401 missing
   header / bad signature (no DB reads — throwing-db app); ready →
   seeded pending row with muxAssetId becomes completed with
   playback id (RPC over pool); ready with unknown asset → 200 +
   message, DB untouched; ready without playback id → 500 (Mux will
   retry); errored → pending row failed with joined messages;
   errored with no messages → `Unknown Mux error`; errored with no
   pending row → 200 no-op; unhandled event type → 200 `Ignored
   event: ...`; missing data.id → 200; the deadlock pin from step 2;
   scoped-parser isolation test; canonical log fields. No client
   changes (Mux is the only caller).

6. Run: root `npx vitest run server`, server `npm run typecheck`,
   eslint on changed files. Update the plan's Status (done entry +
   analysis + next: #17 stripe-webhooks) and update
   `plans/suggested_changes.md`: mark the re-publish deadlock
   RESOLVED (step 2) and mark the `mux_video_purge_candidates` and
   shared-video-get `is_deleted` bullets accordingly (fn deleted /
   column gone — moot). New candidates spotted at prompt time: no
   timestamp tolerance on signatures (unlimited replay, edge
   parity); `mux_video_complete` matches ANY status (a
   canceled/failed row is silently revived to completed by a late
   webhook — maybe fine, note it); `render_purge_candidates.sql` is
   ORPHANED (its only caller was the never-existing render-purge
   edge fn — part13 missed it; decommission candidate: graveyard
   DROP, ask the user). Then PAUSE for my verification, in this
   order: (1) I apply the migration to prod (`supabase db push
   --linked`) and run `sql/deploy.sh --remote` (graveyard: drops the
   RPC + unschedules the mux-video-purge cron); (2) Railway: set
   `MUX_WEBHOOK_SECRET`, deploy; (3) the hard swap in the Mux
   dashboard (mind the per-endpoint signing secret); (4) publish a
   project from the flag-on local webapp — webhook completes the
   mux_video, shared page plays; then RE-publish a new version of
   the same project — the old deadlock case — and watch v2 complete
   alongside v1.

Conventions & gotchas: `server/README.md` governs. Nothing is ever
deleted from Supabase (the SQL-fn deadlock fix, if approved, is a
separate user-confirmed change). Root `.env.test` is committed on
purpose. CI runs the root vitest config with `supabase start` +
`sql/deploy.sh` (mux_video_complete deploys there). Ajv coercion is
ON (moot here — raw body). No stashing for inspection — `git show
HEAD:path`. Debug before fixing. Use build:extension:dev, never
build:extension. Known pre-existing failures, not yours:
cloudProjectService.test.ts "passes expected version to
CloudStorage"; VideoPage.tsx 3 react-hooks eslint findings;
StripeService.ts 2 `no-explicit-any`; cloudStorage.ts
`project_data: any`; useCloudRender.ts 6 `no-explicit-any`;
Header.tsx 4 findings.
