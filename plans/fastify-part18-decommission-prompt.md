# Part 18 prompt — Step 5: decommission (post-soak, the FINAL step)

Finish the Supabase → Fastify migration. Read
`plans/fastify-part1-edge-functions-migration.md` first — its "Status"
section is the source of truth. By this point every edge function is
migrated, removed, or dead; this step deletes the corpses. Also read
`plans/suggested_changes.md` — this pass RESOLVES several parked
bullets; mark them.

**GATE — confirm ALL of these with the user BEFORE touching anything;
if any is false, STOP:**
1. Wave E is user-verified (welcome + invite emails flow through the
   server; unsubscribe undeployed).
2. The prod webapp flag flip is deployed (`VITE_USE_SERVER=true` +
   `VITE_API_URL` baked in) and has SOAKED: the Supabase dashboard
   shows ZERO edge-function invocations for a full week.
3. The user is ready to lose the env-var kill-switch (decision
   2026-07-24: the client wrapper collapses to server-only; rollback
   afterwards = redeploy an older webapp build — the edge fns the
   flag fell back to are being deleted anyway).

No new env vars. Repo work + a manual dashboard checklist for the
user. Everything deleted here is preserved in git history.

1. **Delete the edge-function source tree** — the whole
   `supabase/functions/` directory INCLUDING `_shared/` (user decision
   2026-07-24; git history keeps it). Guard first: grep the repo for
   imports from `supabase/functions` (there should be none — the
   server ported everything; the Deno copies of
   projectAccess/projectMedia/muxUpload die here). Check the root
   `supabase/config.toml` for per-function `[functions.*]` blocks and
   remove them. CI needs no edit (verified 2026-07-24: no workflow or
   script ever ran `functions deploy`; `server-tests.yml` only uses
   `supabase start` + migrations + seed + sql/deploy.sh).

2. **Drop the orphaned SQL functions** (delete each
   `sql/functions/*.sql` + add graveyard `DROP FUNCTION IF EXISTS`
   with the right signatures; verify zero callers first with a
   repo-wide grep — client RPCs, server code, other SQL):
   - `subscription_workspace_get` (orphaned by Wave A #3 3/3 —
     subscription-change ported it inline; its "Called by:
     WorkspaceSettingsPage" header was stale).
   - `set_project_expiry` (orphaned by Wave D #17 decision b — the
     server webhook never touches projects; its last caller was the
     edge stripe-webhooks fn, dead since the Stripe endpoint was
     disabled).
   - `render_purge_candidates` (orphaned since BIRTH — its only
     intended caller was the never-existing render-purge edge fn;
     part13 missed it; user approved the drop 2026-07-24).

3. **Decommission the last Pattern-B cron**: delete
   `sql/crons/cron_purge_deleted_projects.sql` + graveyard guarded
   `cron.unschedule('projects-purge-deleted')` (its edge fn
   `purge-deleted-projects` dies with the tree; the server job
   `projects.purge-deleted` replaced it in Wave C and has run daily
   since). The two pure-SQL watchdogs
   (`render-jobs-stale-cleanup`, `mux-videos-stale-cleanup`) STAY —
   they call render_job_complete/mux SQL directly, no edge
   dependency. Deploy locally (`sql/deploy.sh`); verify local
   `cron.job` shows ONLY the two watchdogs.

4. **Delete the dead v1 client chain** (user decision 2026-07-24,
   confirmed dead 2026-07-16): `CloudStorage.createProject` (the last
   direct `supabase.functions.invoke` call site, cloudStorage.ts) and
   `CloudProjectService.importRecordingLocal`; then AUDIT the v1
   helpers around them (`uploadMedia`, quota_exceeded branches — the
   vestigial-error-shape bullet in suggested_changes) and delete
   whatever becomes unreachable. Only the V2 pipeline (ImportPage →
   importRecordingLocalV2 → project-create-v2) survives. Fix any
   tests that referenced the deleted methods (e.g. the known-failing
   cloudProjectService.test.ts expectation may simply die with its
   subject — if so, note the known-failures list shrinks).

5. **Collapse the client wrapper to server-only** (user decision
   2026-07-24): `webapp/src/api/client.ts` — `invokeFunction` ALWAYS
   POSTs `${VITE_API_URL}/${name}`; DELETE `MIGRATED_FUNCTIONS`, the
   `VITE_USE_SERVER` check, and the `supabase.functions.invoke`
   fallback. KEEP: the supabase-shaped `{ data, error }` return, real
   `FunctionsHttpError`/`FunctionsFetchError` instances, Bearer =
   current session token, `authAwareFetch` (the 401 funnel), the
   missing-VITE_API_URL error (now unconditional — the var is
   REQUIRED). Update `vite-env.d.ts` + `webapp/.env.example`
   (VITE_USE_SERVER gone; VITE_API_URL documented required) and
   `client.test.ts` (flag-off/unregistered cases die; URL/headers/
   body, no-session, non-2xx, network error, 401 funnel,
   missing-VITE_API_URL stay). BEFORE deleting: verify every
   `invokeFunction` call-site name has a matching server route
   (grep call sites vs `server/src/routes/` paths) — the registry
   was the safety net. Final gate: repo-wide
   `grep -r "functions.invoke" webapp/` returns NOTHING.

6. Run: root `npx vitest run server webapp/src`, webapp `tsc -b`,
   server typecheck, eslint on changed files. Update the plan's
   Status: Step 5 entry + a **MIGRATION COMPLETE** marker in the
   header line; update `server/README.md`'s Rollback section (edge
   functions no longer exist — rollback is now git history / previous
   deploys). Update `plans/suggested_changes.md`: mark RESOLVED/moot
   the bullets this kills (stripe-add-seats dead code; project-create
   dead code + vestigial quota_exceeded branches; the Deno
   `_shared/projectAccess` swallow-bug; "shared projectMedia ×3" →
   ×2; the edge purge-deleted-projects bugs; the edge
   send-workspace-invite display_name bug note — edge copy gone).
   Then PAUSE and hand the user the manual checklist, in this order:
   1. `supabase/sql/deploy.sh --remote` — drops the three SQL fns,
      unschedules `projects-purge-deleted`. Verify prod `cron.job`
      shows only the two watchdogs.
   2. Delete ALL edge functions from the Supabase project
      (`supabase functions delete <name>` per remaining function, or
      dashboard) — list them explicitly in your handoff, including
      the never-migrated dead ones (`stripe-add-seats`,
      `project-create`).
   3. Supabase dashboard → Edge Functions → Secrets: delete the
      now-unused secrets (STRIPE_*, MUX_*, OPENAI_API_KEY,
      RESEND_API_KEY, RENDER_*, etc. — they live on Railway now).
   4. Supabase dashboard → Storage/S3 keys: revoke the OLD S3 access
      key pair (pre-2026-07-16, kept alive only for the edge fns;
      Railway uses the new pair).
   5. Stripe dashboard → Webhooks: DELETE the disabled Supabase
      endpoint (it was only disabled at #17 cutover).
   6. Optional Vault prune: `SUPABASE_URL` is unused once the cron is
      gone. **`SUPABASE_SECRET_KEY` STAYS** — it is the bearer
      trial_start/workspace_invite send to the server's email routes.
   7. Deploy the prod webapp with the collapsed wrapper
      (`VITE_API_URL` still baked in; `VITE_USE_SERVER` now
      meaningless — remove it from the deploy env). Safe in any
      order relative to step 2: the flag-on webapp already routes
      every registered function to the server.
   8. Final verification: click through publish/render/share/
      billing/invite/transcribe flows on prod; Railway logs show
      traffic; Supabase edge dashboard is empty. THE MIGRATION IS
      DONE.

Conventions & gotchas: `server/README.md` governs. Root `.env.test`
is committed on purpose. CI runs the root vitest config with
`supabase start` + `sql/deploy.sh` (the graveyard drops apply in CI's
throwaway DB too — fine). The `supabase db push` flow is NOT part of
this step (no schema changes). No stashing for inspection —
`git show HEAD:path`. Debug before fixing. Use build:extension:dev,
never build:extension. Known pre-existing failures, not yours (list
may SHRINK with step 4): cloudProjectService.test.ts "passes expected
version to CloudStorage"; VideoPage.tsx 3 react-hooks eslint
findings; cloudStorage.ts `project_data: any`; useCloudRender.ts 6
`no-explicit-any`; Header.tsx 4 findings.
