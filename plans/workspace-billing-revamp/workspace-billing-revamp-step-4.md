# Step 4 — Active-Project Cap (replaces 14-day expiry)

**Status:** Implemented 2026-09-01 — cap matrix + membership + restore-gate
suites green (66 tests across the four touched server suites; full vitest run
718 passed with only the 33 pre-existing baseline failures, verified present
at HEAD — see agent-suggestions #8), server typecheck, webapp + extension dev
builds, migration applied + smoke-verified locally (14 stale `expires_at`
rows → 0). Divergences from this design are in §11. **Outstanding:** the §8
manual browser smoke of the recovery panel (needs a real extension-recording
handoff); prod deploy (server → migration → webapp).
**Parent:** [`workspace-billing-revamp-tiered-plan.md`](workspace-billing-revamp-tiered-plan.md)
(Step 4). Read that doc first — the entitlement matrix, decision log, and step
ordering live there.

**Goal:** Remove the last remnants of the 14-day project expiry and replace it
with the active-project cap: free workspaces are limited to **N = 5** live
projects per user per workspace, enforced server-side at project creation, with
an at-cap state on the import page and a truthful usage meter in the dashboard
sidebar. Trial and pro workspaces are uncapped. Over-cap workspaces (lapse,
grandfather) keep everything and are only blocked from creating more.

---

## 1. Decisions (resolved from the parent doc's open questions + 2026-09-01 chat)

| Question | Decision |
|---|---|
| Exact N | **5** (decided 2026-09-01 chat). `FREE_PROJECT_CAP` changes 3 → 5. Coincidentally matches the sidebar's stale `FREE_PROJECT_LIMIT = 5` hardcode — but the hardcode is still replaced by the entitlements value. |
| Pre-cap warnings | **The existing sidebar meter is the pre-cap warning.** The "X of N projects used" panel (a Step 3 surface) already renders for free workspaces at all counts; no additional warnings (no toasts, no import-page nag below cap). |
| Restore from trash | **Stays Pro-only** (decided 2026-09-01 chat — preserves today's client UX). `/project-restore` gains the missing server gate; a new `canRestore` entitlement flag replaces the client's `hasNonFreeAccess` derivation. Trash is a one-way door for free users, so restore can never defeat the cap and restores never need cap-counting. |
| What counts as "live" | `deleted_at IS NULL AND permanently_deleted = false AND upload_status = 'ready'`, counted by `owner_id` within the workspace — exactly the set the dashboard displays. Pending-upload rows do NOT count (an abandoned pending row is invisible in the UI; letting it consume a slot would strand users at a phantom cap with no way to free it). |
| Upsert retries | The count **excludes the project id being upserted** — `/project-create-v2` is an idempotent upsert (client-generated id, `ON CONFLICT (id) DO UPDATE`); a retry/resume of the same import must never self-block. |
| Race window | Accepted: concurrent imports can briefly exceed the cap (cap checks `ready` rows; confirm-upload flips pending → ready with no check). Self-healing — an over-cap workspace just blocks the next create, same as grandfathering. Mirrors the parent's accepted share-then-download loophole stance. |
| Grandfathering | Over-cap = keep everything, block new creation until under cap (parent §3). Falls out of the count check naturally — no special casing. |
| Membership gate | `/project-create-v2` gains the missing `isWorkspaceMember` check (verified absent 2026-09-01 — any authed user can currently insert into any workspace id). The cap is unenforceable without it: a capped user could otherwise create in an arbitrary workspace. |
| Error contract | **403 `{ error: 'project_cap_reached', cap }`** — machine-distinguishable from the Step 1 gates' `subscription_required`, and carries the cap so the import page renders the number without needing entitlements loaded. |
| At-cap import UX | **One-screen recovery panel on the import page** (decided 2026-09-01 chat) — the recording must survive the at-cap moment with zero tab-juggling. Three ways out, each ending in an automatic retry: delete an owned project inline, save to a different workspace (multi-workspace members only), or upgrade / extend trial. No dashboard round-trip. |
| Upgrade CTA navigation | **"Upgrade now" opens the billing page in a NEW tab** (decided 2026-09-01 chat) — generally, not just on the import page: ProUpgradeModal and ProGate currently `navigate()` in-tab, which would destroy the import page's recording state (and drops editor/dashboard context elsewhere for no reason). After upgrading in the other tab, "Try again" on the import page just works — the server re-checks entitlements on every create, so stale client state is irrelevant. |
| `expires_at` column | Stop writing it, null the stale values by migration, drop it from payloads/types/UI. The physical column **DROP is deferred to Step 8** — dropping now would break the still-deployed old server (its `projectList`/`projectGet` SELECT the column) during the deploy window. |

## 2. Current state (verified in code, 2026-09-01)

- **The expiry is already half-dead.** The `projects-delete-expired` cron and
  `cleanup_expired_projects()` were dropped 2026-07-18
  (`supabase/sql/graveyard.sql:49-51`) — nothing deletes expired projects.
  What survives: `projectCreateV2.ts:41` (`EXPIRY_MS`) and `:105-115` (stamps
  `expires_at = now + 14d` unless the subscription is `active`/`past_due`);
  `projectList.ts:47` and `projectGet.ts:53` return the column; ProjectCard
  (`webapp/src/pages/dashboard/ProjectCard.tsx:82`, `:276-281`) renders a
  countdown badge that no longer corresponds to any deletion. The server
  stripe webhook never writes `expires_at` (pinned by its tests) — nothing to
  change there.
- **Exactly one creation path.** The only `INSERT INTO projects` in the server
  is `/project-create-v2`; its only caller is the webapp import flow
  (`cloudStorage.ts:145` ← `CloudProjectService.importRecordingLocalV2` ←
  `ImportPage.performUpload`). The extension hands recordings to the import
  page; it never calls the API itself (parent's "import page handles the
  at-cap moment" holds). `project_confirm_upload` (client RPC) only flips
  `upload_status` pending → ready on an existing row — no cap concern.
- **No membership check on create.** `projectCreateV2` validates auth
  (`requireUser`) but never checks the caller belongs to `workspaceId`.
  `projectList.ts:32` shows the pattern to copy: `isWorkspaceMember`
  (`services/projectAccess.ts`, owner-implicit per Step 2) → 403.
- **Entitlements plumbing is ready.** `projectCap` has shipped in the payload
  since Step 1 (`entitlements.ts:63` — `paid ? null : FREE_PROJECT_CAP`,
  currently 3); no shape change needed for the cap itself. Comment at
  `entitlements.ts:22` marks projectCap as "computed but not yet enforced".
- **Sidebar meter exists but lies twice.**
  `DashboardSidebar.tsx:12` hardcodes `FREE_PROJECT_LIMIT = 5` (server says
  3), and `DashboardPage.tsx:307` passes `projects.length` — all live
  workspace projects, not the caller's owned ones (the cap is per-user).
  The at-cap upsell + `TrialExtendLink` (`:136-143`, Step 3 surface) carries
  over unchanged.
- **Restore is client-gated only.** `/project-restore` is owner-only via its
  WHERE clause, no tier check. `ProjectCard.tsx:199-209` wraps the restore
  button in `ProGate feature="restoring deleted videos"` when
  `restoreGated={!hasNonFreeAccess}` (`DashboardPage.tsx:416`).
- **Client error surfacing:** `invokeFunction` returns `FunctionsHttpError`
  with the raw `Response` on `.context` for non-2xx — the import page's catch
  can `await error.context.json()` to read `{ error: 'project_cap_reached',
  cap }`. No existing client code branches on Step 1's `subscription_required`
  (gates are hidden preemptively via entitlements); the import page is the
  first surface that must branch on a server error code, because recording
  happens before the client knows the count.
- **Recovery-panel building blocks all exist server-side**: `/project-list`
  (summaries incl. `owner_id`, name, duration), `/project-delete` (soft
  delete), `/workspace-list` (the member's workspaces — Step 2 synthesizes
  the owner; verify the role field during implementation),
  `/workspace-set-default`. No new routes needed. `performUpload` is already
  re-runnable — the recording blobs stay in the bridge/local state across
  failed attempts.
- **Upgrade CTAs navigate in-tab today**: `ProUpgradeModal.handleUpgrade` →
  `navigate('/workspace/settings/billing')`; `ProGate.tsx:46` →
  `navigate('/workspace/settings?tab=billing')`. (Note the two paths differ —
  verify which is canonical during implementation; unify while switching to
  new-tab.)
- **`expires_at`/`expiresAt` reference sweep** (grep 2026-09-01, project-expiry
  only — `workspace_invitations.expires_at` and `workspaceGet.ts`'s invitation
  comments are a different feature, untouched): `projectCreateV2.ts`,
  `projectList.ts`, `projectGet.ts`, `shared/api/projects.ts`,
  `cloudProjectService.ts` (+ its test), `ProjectCard.tsx`,
  `DashboardPage.tsx`, `server/test/helpers/db.ts`,
  `server/test/projects/projectCreateV2.test.ts`, `supabase/seed.sql`,
  `supabase/sql/tables/projects.sql`.

## 3. Data changes

One migration (`supabase/migrations/` — schema/data only, per conventions):

```sql
-- Step 4: the 14-day expiry is replaced by the active-project cap.
-- Nothing has enforced expiry since the cron was dropped (graveyard
-- 2026-07-18); null the stale timestamps so no client ever renders a
-- false countdown again. Column drop deferred to Step 8.
UPDATE projects SET expires_at = NULL WHERE expires_at IS NOT NULL;
```

`supabase/sql/tables/projects.sql`: comment `expires_at` as deprecated
(dead since Step 4, dropped in Step 8). `supabase/seed.sql`: stop seeding
`expires_at`. No new columns, no env vars.

## 4. Server changes

**`services/entitlements.ts`**
- `FREE_PROJECT_CAP` 3 → **5**.
- `entitlementsForState` gains `canRestore: paid` (same tier as the other
  paid flags — trial included, matching today's `hasNonFreeAccess` client
  gate).
- Header comment: projectCap enforced as of Step 4 (canInvite remains the
  only computed-not-enforced flag, Step 6).

**`routes/projects/projectCreateV2.ts`** — the heart of the step:

1. Membership first: `isWorkspaceMember(db, workspaceId, userId)` → 403
   `{ error: 'Not a member of this workspace' }` (copy `projectList.ts:32-34`).
2. Cap check — `getWorkspaceEntitlements(db, clock, workspaceId)`; when
   `projectCap !== null`:

```sql
SELECT COUNT(*)::int AS count FROM projects
WHERE workspace_id = $1 AND owner_id = $2
  AND deleted_at IS NULL AND permanently_deleted = false
  AND upload_status = 'ready'
  AND id != $3            -- the row being upserted: retries never self-block
```

   `count >= projectCap` → **403 `{ error: 'project_cap_reached', cap:
   projectCap }`**.
3. Expiry removal: delete `EXPIRY_MS`, the subscription-status query
   (`:105-115` — the entitlements call replaces it), and `expires_at` from the
   INSERT column list and `ON CONFLICT` SET. Update the route's header
   comment ("decides expiry from the workspace subscription" → the cap).

**`routes/projects/projectRestore.ts`** — look up the project's
`workspace_id` (owner-only as today), then `getWorkspaceEntitlements`; when
`!entitlements.canRestore` → 403 `{ error: 'subscription_required' }` (the
Step 1 gate convention — restore is a tier gate, not a cap gate). Keep the
existing guarded UPDATE untouched.

**`routes/projects/projectList.ts` / `projectGet.ts`** — drop `expires_at`
from the jsonb payloads.

## 5. Shared contract changes

- `shared/api/entitlements.ts`: `WorkspaceEntitlements` gains
  `canRestore: boolean` (doc comment: restore-from-trash is trial/pro;
  enforced by `/project-restore`).
- `shared/api/projects.ts`: remove the project-expiry field from the
  summary/get shapes (`expires_at`/`expiresAt` — verify exact field names
  during implementation; invitation expiry in `workspaces.ts` is untouched).
- `project-create-v2` contract note: 403 body may be
  `{ error: 'project_cap_reached', cap: number }` or a plain
  `{ error }` (membership). Response schema on the route gains the `cap`
  optional field on 403.

## 6. Frontend changes

**Plumbing** — `FREE_ENTITLEMENTS` (`useEntitlements.ts`) gains
`canRestore: false`. `cloudProjectService.ts` drops the `expiresAt` mapping.

**`ProjectCard.tsx`** — delete the expiry countdown badge (`:82`, `:276-281`;
the trash purge-days display stays). `restoreGated` prop stays; its value
changes at the call site.

**`DashboardPage.tsx`** — `restoreGated={!entitlements.canRestore}` instead
of `!hasNonFreeAccess`; pass the sidebar a per-user owned count
(`projects.filter(p => p.ownerId === userId).length`) and
`entitlements.projectCap` (nav counts keep using workspace-wide numbers).

**`DashboardSidebar.tsx`** — delete `FREE_PROJECT_LIMIT`; the meter renders
when `projectCap != null` (replacing the `!hasNonFreeAccess` condition —
same set, sourced from the payload): `{ownedCount} of {projectCap} projects
used`, at-cap treatment (destructive bar + upsell + `TrialExtendLink`) at
`ownedCount >= projectCap`, unchanged otherwise.

**Upgrade CTAs open a new tab** — `ProUpgradeModal`'s "Upgrade now" and
`ProGate`'s "Upgrade →" switch from in-tab `navigate()` to
`window.open('/workspace/settings/billing', '_blank')` (unify the two
billing paths while there; modal still closes on click). This is a general
change, not import-page-specific: the caller's context (recording, editor
state) always survives. The at-cap panel's upgrade button uses the same
behavior.

**`ImportPage.tsx` — the at-cap recovery panel.** In `performUpload`'s
catch, detect `FunctionsHttpError` with body
`error === 'project_cap_reached'` → new status `'error-cap'` (instead of
the generic `'error-upload'`). The recording is never lost — it stays in
the bridge/local state exactly as for other import errors, and every path
below ends in re-running `performUpload`. On entering the state, fetch
`/project-list` (current workspace) and `/workspace-list`.

> **You've reached the Free plan's limit of {cap} active projects.**
> Your recording is safe — free up a slot below and we'll save it right
> away.

Panel sections, in order:

1. **Delete a project** — the caller's owned live projects (list filtered
   to `ownerId === userId && !deletedAt`), compact rows: name, relative
   date, duration, a "Move to trash" button. One confirm step
   ("Moves to trash — this frees a slot immediately"); honest copy matters
   here since free users cannot restore (Pro-only, this step). On success
   → auto-retry the import.
2. **Save to a different workspace** — rendered only when `/workspace-list`
   shows another workspace where the user can create (role creator/admin;
   exclude the capped current one). Picking one calls
   `/workspace-set-default`, updates the workspace store, and retries with
   that `workspaceId` — the literal "change default workspace" path, so the
   next recording lands there too instead of re-hitting the same wall.
   Cross-workspace caps still apply server-side; if the target is also
   free-and-full the panel simply re-renders for it.
3. **Upgrade to Pro** (new tab, per above) + `TrialExtendLink` (Step 3
   rule: every upgrade surface), and a plain **Try again** fallback — after
   upgrading or extending in the other tab/modal, retry succeeds because
   the server re-derives entitlements on every create.

Analytics: `trackImportFailed` with `phase: 'cap'` on entry (+ existing
`trackProjectCreationFailed` untouched); track which exit was used
(`cap_recovered_delete` / `cap_recovered_workspace` / upgrade click).

## 7. Intentional behavior changes

1. **New projects never expire**, for anyone. Stale `expires_at` values are
   nulled; the false countdown badge disappears.
2. **Free workspaces hit a wall at 5**: `/project-create-v2` refuses the 6th
   live project per user (server-enforced; import page renders the state).
   Trial and pro workspaces are uncapped — trial lifts limits (parent §2).
3. **Over-cap keeps everything**: a lapsed workspace with 8 projects loses
   nothing; creation is blocked until it's under 5 (delete 4). One-way-door
   workspaces (canceled sub) are `free` ⇒ capped.
4. **Restore is now actually enforced** trial/pro (was client-only theater —
   any free user could call `/project-restore` directly).
5. **`/project-create-v2` now requires workspace membership** (was: any
   authenticated user, any workspace id).
6. **The sidebar meter tells the truth**: server-sourced cap (5), per-user
   owned count (was: hardcoded 5 vs server's 3, counting the whole
   workspace).
7. **Upgrade CTAs open the billing page in a new tab** (ProUpgradeModal,
   ProGate, the at-cap panel) — was in-tab navigation, which destroyed the
   caller's context.
8. **Hitting the cap mid-import is recoverable in place**: delete inline,
   switch default workspace, or upgrade/extend — all without leaving the
   import page or losing the recording.

## 8. Testing

Server (`server/test/`, vitest — validation tier + real-Postgres e2e):

- **`projects/projectCreateV2.test.ts`** — the expiry matrix (`:225-256`)
  is **replaced** by the cap matrix:
  - free workspace, under cap → 200; `expires_at` stored NULL.
  - free at cap (5 live ready owned) → 403 `project_cap_reached`, `cap: 5`.
  - not counted: soft-deleted, `pending`-upload, other-owner (same
    workspace), same-owner-other-workspace rows → 200 at nominal cap.
  - retry: upsert of an id that's one of the 5 → 200 (no self-block).
  - trial workspace (future `trial_ends_at`, no sub) at 5+ → 200.
  - `active` and `past_due` subs at 5+ → 200; `canceled` sub (one-way door
    ⇒ free) → capped.
  - non-member / stranger workspace id → 403 membership error (also covers
    the new-hole regression).
- **`projects/projectRestore.test.ts`** — free workspace → 403
  `subscription_required`, row stays deleted; trial and pro → restored;
  non-owner unchanged (untouched row).
- **`entitlements.test.ts`** — cap rows now expect 5; `canRestore` matrix
  (free false / trial true / pro true / past_due true / canceled false).
- **`billing/subscriptionGet` e2e** — payload pin gains `canRestore`.
- **`helpers/db.ts` + `seed.sql`** — drop `expires_at` from seed helpers.
- Migration smoke: apply locally, confirm stale `expires_at` nulled.

Webapp: typecheck (contract changes surface every `expiresAt` straggler) +
dev build. Manual smoke of the recovery panel against the local stack:
seed a free workspace at cap → record/import → panel appears → each exit
path (inline delete, workspace switch, try-again after upgrade) completes
the import with the original recording. Extension: typecheck + dev build
(no cap code there — expect no-op).

## 9. Implementation order

1. Shared contract: `canRestore`, project-shape `expiresAt` removal.
2. Server: entitlements (cap 5 + `canRestore`), `projectCreateV2` rewrite
   (membership → cap → no expiry), `projectRestore` gate, list/get payload
   removal.
3. Tests: cap matrix, restore suite, entitlements/subscriptionGet updates,
   helper cleanup.
4. Migration + `sql/tables/projects.sql` comment + seed update.
5. Webapp: plumbing, ProjectCard, DashboardPage/Sidebar meter, upgrade
   CTAs → new tab (ProUpgradeModal/ProGate, unified billing path),
   ImportPage recovery panel, analytics.
6. Deploy: **server → migration → webapp**. Server first stops the
   `expires_at` writes and starts enforcing (old webapp bundles just get
   server 403s they render as generic import errors — acceptable window);
   the migration then nulls everything stale (including rows the old server
   wrote during the deploy); webapp last ships the at-cap UX and truthful
   meter. No env changes.

## 10. Out of scope (later steps / accepted)

- **Extension-side pre-recording cap warning** — deferred (parent §8); the
  import page is the at-cap moment.
- **`projects.expires_at` column DROP** — Step 8, after no deployed server
  references it.
- **Pending-row hygiene** — abandoned `pending` uploads are invisible and
  don't count toward the cap; a cleanup job is a nice-to-have, not this
  step. Record in agent-suggestions if it itches during implementation.
- **Trash purge** — ProjectCard's 30-day purge display is client-side only;
  whether a real purge job should exist belongs to Step 7's soft-delete
  recovery-window decision.
- Render rate limits (Step 5), invite gating & seats (Step 6), lapse state
  machine (Step 7).

## 11. Implementation notes (2026-09-01)

Shipped as designed, with these divergences:

- **Seed helper kept `expiresAt`** (§8 said drop it): the stripe-webhooks suite
  legitimately seeds dated projects to pin "the webhook never touches
  projects.expires_at". The option dies with the column in Step 8. `seed.sql`
  did drop its expiry value.
- **`sql/tables/projects.sql` untouched**: it's a generated snapshot
  (`dump-tables.sh --linked`), not hand-edited source — it regenerates when
  Step 8 drops the column.
- **The upgrade-CTA sweep found two more in-tab navigations** — the editor
  Header's `DownloadModal onUpgrade` and DashboardPage's post-checkout
  redirect; both now use the canonical `/workspace/settings/billing`. The old
  `?tab=billing` form was a live mis-navigation: the bare-path redirect in
  `App.tsx` drops the query, so those CTAs landed on the General tab.
- **`PRO_ENTITLEMENTS` dev override** (`useWorkspaceStore.ts`, VITE_DEV_PRO_UID)
  gained `canRestore: true` — a payload-shape consumer §6 missed.
- **Restore-gate shape**: the workspace lookup is owner-scoped, so a non-owner
  falls through to the unchanged guarded UPDATE and gets `restored: false` —
  the 403 never leaks tier info to non-owners (pinned by test).
- **Analytics**: one `import_cap_recovery` event with an `action` param
  (`delete` / `switch_workspace` / `upgrade`) instead of per-exit events;
  entry fires `trackImportFailed` with `phase: 'cap'`. The cap refusal is NOT
  sent to Sentry — it's expected product behavior.
- **Panel delete is two-step inline** (arm → "Move to trash" confirm) rather
  than a modal; free-user copy stays honest about trash being one-way.
- Cap check runs before path stamping; the 403 response schema carries the
  optional `cap` field; the count query excludes the upserted id exactly as
  designed.

Deploy checklist (not yet done): server → prod migration → webapp, per §9.

### UI feedback round (2026-09-01, after the user's manual smoke)

The recovery panel and restore gate were reworked on real-browser feedback:

- **Panel**: elevated card (`bg-surface-raised` + `shadow-float` — it blended
  into the white page); rows show the real thumbnail (via
  `CloudProjectService.loadThumbnails`) next to name/date/duration; the list
  scrolls (`max-h-60`); a live "X of {cap} projects used" meter (sidebar
  styling) sits above it and updates as rows are deleted.
- **Delete is one click, no confirm, and does NOT auto-retry** (reverses §6):
  the meter drops, and once a slot is free the primary CTA flips from
  "Upgrade to Pro" to **"Save recording"** (runs the retry); Upgrade demotes
  to the secondary button. At/over cap the footer stays
  Upgrade-primary + ghost "Try again".
- **Restore is no longer a dimmed ProGate** (client affordance only — the
  server `canRestore` gate is unchanged): the trash Restore button always
  presses; on a free workspace `DashboardPage.handleRestore` opens
  `ProUpgradeModal feature="restoring deleted videos"` instead of calling the
  route. `restoreGated` prop deleted from ProjectCard.
