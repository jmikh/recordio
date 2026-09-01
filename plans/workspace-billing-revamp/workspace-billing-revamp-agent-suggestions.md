# Workspace Billing Revamp — Agent Suggestions

Out-of-scope findings noticed during implementation, recorded instead of expanding
scope inline (per `.claude/skills/planning`). Each entry: what, where, why it
matters, sketch of the fix.

## From Step 1 (2026-09-01)

### 1. New signups get no trial — `user_profile_create` trigger doesn't set `trial_ends_at`

- **Where:** `supabase/sql/functions/user_profile_create.sql` (sets only `name` +
  `updated_at`); the column has no DEFAULT (`supabase/migrations/00000000000000_schema.sql:1162`).
  The original schema-era trigger inserted `now() + interval '7 days'` (line 324).
- **Why it matters:** every user signed up since the trigger was rewritten has
  `trial_ends_at = NULL`, i.e. **free from day one** — no 7-day trial, client and
  (since Step 1) server both read it that way. Directly undermines the trial
  funnel the revamp is built around.
- **Sketch:** re-add `trial_ends_at = now() + interval '7 days'` to the trigger
  now, or fold into Step 2 (which moves the trial onto `workspaces.trial_ends_at`
  at signup anyway). If fixing pre-Step-2, decide whether to backfill existing
  NULL-trial profiles.
- **Decision (2026-09-01):** fix lands with Step 2's trial-to-workspace move — no
  interim trigger patch. Folded into the Step 2 scope in the tiered plan; backfill
  policy decided in the step doc.

### 2. Legacy integration suites always fail — they test the decommissioned Supabase stack

- **Where:** `test/integration/edge-functions.test.ts`,
  `test/integration/supabase-rpc.test.ts`, `test/integration/render-worker.test.ts`
  (+ helpers in `test/helpers/`).
- **Why it matters:** 30+ permanently red tests in every `vitest run` — noise that
  buries real failures. They target edge functions and SQL RPCs graveyarded by the
  Fastify migration (commits "graveyarding supabase rpcs", "migrate remaining
  RPCs") and require `supabase functions serve` + MinIO to even connect. The
  Fastify server suites (`server/test/`) cover the same routes.
- **Sketch:** delete the three suites (and any now-orphaned helpers), or move
  anything still unique into `server/test/`. If some are intentionally kept until
  edge decommission, gate them behind `describe.runIf(<edge stack up>)` so they
  skip instead of fail.

### 3. Stale assertion in `cloudProjectService.test.ts`

- **Where:** `webapp/src/storage/cloudProjectService.test.ts` — "passes expected
  version to CloudStorage" expects a 4th `true` argument to
  `CloudStorage.saveProjectMetadata` that the implementation no longer passes.
- **Why it matters:** pre-existing red test (fails on every run); either the test
  pins behavior that was intentionally removed, or a regression slipped through.
- **Sketch:** check the `saveProjectMetadata` signature history; update the test
  to the current call shape (or restore the dropped argument if it was load-bearing).

### 4. Visible `seats * 10` viewer-seat math still in the members UI

- **Where:** `webapp/src/pages/settings/MembersPage.tsx` —
  `VIEWER_SEATS_PER_CREATOR = 10` used at ~line 250 (derived viewer seats) and in
  the invite-section note ("10 viewer seats per creator on Teams. Included free."),
  plus `viewer_seats` (`seats * 10`) still computed server-side in `workspace-get`.
- **Why it matters:** the tiered plan §3 explicitly rejects user-visible
  `seats * 10` math (hidden abuse ceiling instead, §8 "rejected" list). Left in
  place during Step 1 to avoid scope creep; slated for Step 6 — flagged here so it
  isn't forgotten if Step 6's scope shifts.
- **Sketch:** in Step 6, drop `viewer_seats` from the `workspace-get` payload +
  `WorkspaceDetails`, remove the constant and the copy, and gate viewer invites on
  the hidden internal ceiling with the "contact support" response.
