# Step 2 — Workspace Lifecycle: One Per User, Created at Signup

**Status:** Implemented 2026-09-01 — 471 server tests green (incl. the new
signup-bootstrap trigger suite and owner-invite guards), webapp + extension
typecheck and dev builds pass. Divergences from this design are in §11
(Implementation notes) and mirrored in the parent doc's Step log.
**Parent:** [`workspace-billing-revamp-tiered-plan.md`](workspace-billing-revamp-tiered-plan.md)
(Step 2). Read that doc first — the entitlement matrix, decision log, and step
ordering live there.

**Goal:** Every account owns exactly one undeletable workspace, born at signup
with the 7-day trial attached. The trial moves from the owner's
`user_profiles.trial_ends_at` onto `workspaces.trial_ends_at`, and the one-way
door (parent §3 Trial) starts being enforced: a workspace that has ever had a
subscription never derives `trial` again.

---

## 1. Decisions (resolved from the parent doc's open questions)

| Question | Decision |
|---|---|
| Signup-trigger vs lazy bootstrap | **Signup trigger.** The `auth.users` insert trigger creates profile + workspace + default pointer atomically. A one-time backfill creates workspaces for every existing auth user who lacks one, then the create-if-missing branch in `workspace-get-default` is **removed** — a missing workspace becomes a loud 500 (invariant violation), not a silent heal. |
| Owner membership (decided 2026-09-01) | **Implicit — owners get NO `workspace_members` row.** Owner is its own state, derived from `workspaces.owner_id`, and implies admin everywhere; unremovable/undowngradable becomes structural (no row to delete or change) instead of a guard. The migration deletes existing owner rows; `isWorkspaceAdmin`/`isWorkspaceMember` gain the owner override; member listings and the workspace list synthesize the owner server-side so clients stay dumb. `workspace_members` now means exactly "invited members". |
| Multi-workspace owners | **Grandfathered.** Extra owned workspaces stay and keep appearing in the switcher; `/workspace-create` is deleted (Step 1 precedent: routes go away outright), so no new ones can be made. |
| Trial storage | **Columns on `workspaces`**: `trial_ends_at` + `trial_extension_count`. No extensions table — one self-serve extension (Step 3) doesn't justify a table; the count is the only state it needs. |
| Signup-trial-gap backfill (decided 2026-09-01) | Never-pro workspaces whose owner profile trial is NULL get **`trial_ends_at` = migration run time** ("trial ends today") with `trial_extension_count = 0`. They start free, and Step 3's self-serve extension (+7d from extension date, works on lapsed trials) becomes their trial grant on demand — no silent trial burning down for inactive accounts. |
| Live/expired profile trials | **Copied verbatim to every workspace the user owns** — behavior-preserving vs the Step 1 interim, where every owned workspace derived trial from the owner's profile. Live trials keep their remaining time; expired ones stay expired (extension still available). |
| One-way door marker | **Existence of any `subscriptions` row** for the workspace. Rows are written only by Stripe webhooks on successful checkout (`/stripe-checkout` writes nothing itself, verified) and are retained as `status='canceled'` on deletion — so row-exists ⇔ has-ever-been-pro. No new column needed. |
| Trial date delivery to the client | `WorkspaceEntitlements` gains **`trialEndsAt: string \| null`** (ISO; non-null only when `state === 'trial'`). BillingPage reads it now; Step 3's banner/countdown reads the same field. `user_profiles.trial_ends_at` stops being read/written everywhere (physical column drop waits for Step 8, same pattern as `plan`). |
| Account deletion | No deletion route (out of scope). The migration adds **`ON DELETE CASCADE`** to `workspaces.owner_id` and `workspace_members.user_id` so an auth-level user deletion no longer orphans rows. |

## 2. Current state (verified in code, 2026-09-01)

- **Two creation paths.** `workspace-get-default`
  (`server/src/routes/workspaces/workspaceGetDefault.ts`) runs a 4-step heal
  chain: validate stored `default_workspace_id` → fall back to oldest owned
  workspace → **create "My Workspace" + owner admin membership if none** →
  heal the default pointer. `workspace-create`
  (`server/src/routes/workspaces/workspaceCreate.ts`) does the same inserts on
  demand; its only caller is the DashboardPage modal.
- **Owners currently DO have admin membership rows** (both creation paths
  insert them), and access checks are row-based. Chokepoints:
  `isWorkspaceAdmin()` / `isWorkspaceMember()`
  (`server/src/services/projectAccess.ts:82-117`) gate ~14 routes between
  them. Inline `workspace_members` queries live in `workspaceList.ts:23-38`
  (JOIN — an owner without a row wouldn't see their own workspace),
  `workspaceGet.ts:47-70` (caller role + members blob),
  `workspaceGetDefault.ts:29-51,90`, `subscriptionGet.ts:34-56` (member
  gate), `stripePortal.ts:54-62`, and `subscriptionChange.ts:111-171` (admin
  gate + seat floor counts membership rows). The owner-unremovable (409) and
  owner-role-locked guards in `workspaceMemberRemove.ts:53` /
  `workspaceMemberUpdateRole.ts:47` already check `workspaces.owner_id`, not
  the row. Live RLS was dropped (`20260513194112`) — no policy work.
- **Trigger no longer sets the trial.** `user_profile_create()`
  (`supabase/sql/functions/user_profile_create.sql`) inserts only
  `user_id` + `name` into `user_profiles` — `trial_ends_at` stays NULL. This is
  the signup-trial gap (parent §5 Step 2 / agent-suggestions #1).
- **Workspaces schema** (`supabase/sql/tables/workspaces.sql`): `id`, `name`,
  `owner_id` (FK to `auth.users`, **no cascade**), timestamps, `deleted_at`
  (soft-delete column, never set by any route). No unique constraint on
  `owner_id` — multi-workspace owners exist. `is_personal` was already dropped
  by migration `20260512200000`; the parent doc's delta table is stale there.
- **Entitlements** (`server/src/services/entitlements.ts:56-76`) join the
  owner's `user_profiles.trial_ends_at` — the Step 1 interim source.
  `deriveEntitlementsState` is `pro` if status ∈ `active|past_due|trialing`,
  else `trial` if the trial date is in the future, else `free` — including the
  accepted interim edge (lapsed sub + live trial ⇒ trial) this step closes.
- **`subscriptions.status` is NOT NULL** — in the entitlements query, a
  non-null status already means "a subscription row exists". The one-way door
  needs no query change beyond reading `w.trial_ends_at`.
- **Client trial plumbing:** `/user-profile-get` returns `trial_ends_at` →
  `AuthManager.fetchProfile()` → `useUserStore.trialEndsAt` +
  `hasFreeTrial()` (`webapp/src/auth/useUserStore.ts:73-78`), displayed on
  `BillingPage.tsx` (~47, 70, 210-212). No trial code in the extension.
- **Creation affordances:** DashboardPage modal + handlers
  (`DashboardPage.tsx:41-42, 207-233, 557-579`), WorkspaceDropdown create
  button + `ownedCount < 5` limit (`WorkspaceDropdown.tsx:53-54, 100-109`),
  DashboardSidebar wiring (`DashboardSidebar.tsx:30, 79`),
  `trackWorkspaceCreateFailed` analytics.
- **Test DB = local `supabase start` Postgres with migrations applied** — the
  signup trigger fires on `seedAuthUser`'s `auth.users` insert
  (`server/test/helpers/db.ts` already half-expects this: "A signup trigger
  may have created one"). Extending the trigger therefore changes what every
  e2e suite gets for free (see §8).

## 3. Data changes (one migration)

`supabase/migrations/<ts>_workspace_trial_signup.sql` — order matters:

**1. Add columns — no default yet.** `ADD COLUMN ... DEFAULT now() + '7 days'`
would backfill every existing row with a fresh trial via the table rewrite;
the default is attached only after the explicit backfill.

```sql
ALTER TABLE public.workspaces
    ADD COLUMN trial_ends_at TIMESTAMPTZ,
    ADD COLUMN trial_extension_count INTEGER NOT NULL DEFAULT 0;
```

**2. Create missing workspaces** for every auth user who owns none (they may
still be members of others' workspaces) and heal the default pointer where
unset — **no membership insert**: owners are implicit. Then delete the
historical owner rows so the model is uniform:

```sql
INSERT INTO public.workspaces (name, owner_id)
SELECT 'My Workspace', u.id
FROM auth.users u
WHERE NOT EXISTS (
    SELECT 1 FROM public.workspaces w
    WHERE w.owner_id = u.id AND w.deleted_at IS NULL
);

UPDATE public.user_profiles up
SET default_workspace_id = (
    SELECT w.id FROM public.workspaces w
    WHERE w.owner_id = up.user_id AND w.deleted_at IS NULL
    ORDER BY w.created_at ASC LIMIT 1
)
WHERE up.default_workspace_id IS NULL;

-- Owner is its own state (workspaces.owner_id) — workspace_members now
-- holds invited members only.
DELETE FROM public.workspace_members wm
USING public.workspaces w
WHERE wm.workspace_id = w.id AND wm.user_id = w.owner_id;
```

Update `supabase/seed.sql` to match (its seeded owner membership rows go
away; seeded invited-member rows stay).

**3. Backfill trials** — copy the owner's profile trial to all their owned
workspaces; NULL (the gap cohort, plus owners with no profile row) means
"ends now":

```sql
UPDATE public.workspaces w
SET trial_ends_at = COALESCE(up.trial_ends_at, now())
FROM public.user_profiles up
WHERE up.user_id = w.owner_id;

UPDATE public.workspaces
SET trial_ends_at = now()
WHERE trial_ends_at IS NULL;  -- owners without a user_profiles row
```

Ever-pro workspaces get a value too — inert, because the one-way door
derivation never reads the trial when a subscription row exists.

**4. Attach the default** for all future inserts (trigger-created workspaces
inherit the trial with zero trigger logic):

```sql
ALTER TABLE public.workspaces
    ALTER COLUMN trial_ends_at SET DEFAULT now() + interval '7 days',
    ALTER COLUMN trial_ends_at SET NOT NULL;
```

**5. FK cascades** (constraint names verified during implementation; drop
defensively like Step 1 did for the seats constraint):

```sql
ALTER TABLE public.workspaces
    DROP CONSTRAINT IF EXISTS workspaces_owner_id_fkey,
    ADD CONSTRAINT workspaces_owner_id_fkey
        FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.workspace_members
    DROP CONSTRAINT IF EXISTS workspace_members_user_id_fkey,
    ADD CONSTRAINT workspace_members_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
```

**6. Replace the signup trigger.** The function's scope grows from
"create profile" to "bootstrap account", so it's renamed:
`user_profile_create()` → `user_signup_bootstrap()`, trigger
`on_user_signup_create_user_profile` → `on_user_signup_bootstrap`
(drop old, create new in the migration; rename the mirror files under
`supabase/sql/functions/` and `supabase/sql/triggers/`):

```sql
CREATE OR REPLACE FUNCTION public.user_signup_bootstrap()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    ws_id UUID;
BEGIN
    INSERT INTO public.workspaces (name, owner_id)
    VALUES ('My Workspace', new.id)
    RETURNING id INTO ws_id;

    INSERT INTO public.user_profiles (user_id, name, default_workspace_id, updated_at)
    VALUES (
        new.id,
        COALESCE(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
        ws_id,
        now()
    );

    RETURN new;
END;
$$;
```

The trial comes from the column default — the trigger never mentions it.
Update the per-table DDL doc `supabase/sql/tables/workspaces.sql`.

**Verify during implementation:** nothing live still reads
`user_profiles.trial_ends_at` after this step — including the legacy
`cron_expire_trials` function visible in the graveyarded
`00000000000000_schema.sql` (believed dead with the Supabase stack; confirm
the Fastify scheduler has no equivalent).

## 4. Server changes

**`services/entitlements.ts`** — query swaps the profile join for the
workspace column; derivation gains the one-way door. Because `status` is
NOT NULL on subscription rows, `status !== null` ⇔ row exists — the signature
doesn't change:

```sql
SELECT s.status, w.trial_ends_at
FROM workspaces w
LEFT JOIN subscriptions s ON s.workspace_id = w.id
WHERE w.id = $1 AND w.deleted_at IS NULL
```

```ts
// pro:  status ∈ active|past_due|trialing
// free: any other non-null status — the one-way door: a subscription row
//       exists, so the workspace has been pro and never derives trial again
// trial: no row and trial_ends_at > now
// free: otherwise
```

`entitlementsForState` grows a `trialEndsAt` argument (or the payload is
assembled in `getWorkspaceEntitlements`): non-null only when the state is
`trial`. Header comment updated — the "Step 2 will swap" note comes true.

**Owner-implicit membership** — owner (`workspaces.owner_id`) counts as an
admin member everywhere, without a row:

- `services/projectAccess.ts`: `isWorkspaceAdmin()` / `isWorkspaceMember()`
  become one query each of the shape
  `owner_id = $user OR EXISTS (membership row)` — this alone fixes every
  route gated through them (`workspace-get`, `-rename`, `-invite`,
  `-member-remove`, `-member-update-role`, `-set-default`, `transcribe`,
  `project-list`, …).
- `workspaceList.ts`: owned workspaces UNION member workspaces, owned rows
  synthesized with `role: 'admin'` (ordering stays `created_at ASC, name ASC`).
- `workspaceGet.ts`: member gate via the helper; the members blob gets the
  owner **prepended server-side** as a synthetic `role: 'admin'` entry so
  MembersPage keeps rendering the owner without client changes
  (`isPlanOwner` there already compares against `owner_id`).
- `workspaceGetDefault.ts`: the stored-default validation becomes
  owner-or-member; the oldest-owned fallback already queries by `owner_id`
  (its JOIN on `workspace_members` is simply dropped); the response role is
  synthesized for owners.
- `subscriptionGet.ts` member gate + `stripePortal.ts` membership JOIN:
  owner-or-member.
- `subscriptionChange.ts`: admin gate via owner-or-admin; the **seat floor
  becomes `member rows + 1`** (the owner's seat — previously their
  membership row was counted).
- `workspaceInvite.ts` / `workspaceInviteAccept.ts`: new guard — inviting
  the workspace **owner's own email is rejected** ("already a member" checks
  ran on `workspace_members` and no longer catch the owner; without the
  guard an accepted invite would recreate an owner row).

**`routes/workspaces/workspaceGetDefault.ts`** — delete the bootstrap branch
(step 3 of the heal chain). The chain becomes: validate stored default →
fall back to oldest owned → heal the pointer. No owned workspace after the
backfill+trigger is an invariant violation → 500 (loud), not a create.

**`routes/workspaces/workspaceCreate.ts`** — deleted (route registration,
shared contract entry in `shared/api/workspaces.ts` + `shared/api/index.ts`).
Stale webapp bundles hitting it get 404 and show the modal's error state —
accepted, same deploy-skew reasoning as Step 1 (server → webapp back-to-back).

**`routes/userProfileGet.ts`** — drop `trial_ends_at` from the response.

## 5. Shared contract changes

- `shared/api/entitlements.ts`: `WorkspaceEntitlements` gains
  `trialEndsAt: string | null` (ISO 8601; null unless `state === 'trial'`).
- `shared/api/session.ts`: `UserProfile` drops `trial_ends_at`.
- `shared/api/workspaces.ts` + `shared/api/index.ts`: remove
  `workspace-create`.

## 6. Frontend changes

**Remove creation affordances** (the switcher itself is untouched):
- `DashboardPage.tsx`: `showCreateWorkspace`/`newWorkspaceName` state (41-42),
  `handleCreateWorkspace`/`handleCreateWorkspaceConfirm` (207-233), the create
  modal (557-579), the `onCreateWorkspace` prop pass (351).
- `WorkspaceDropdown.tsx`: `ownedCount`/`canCreateWorkspace` (53-54), the
  "Create workspace" menu item (100-109), the `onCreate` prop.
- `DashboardSidebar.tsx`: `onCreateWorkspace` prop (30) + pass-through (79).
- `analytics/index.ts`: `trackWorkspaceCreateFailed` (~328).

**Trial source swap:**
- `useUserStore`: delete `trialEndsAt` state + `hasFreeTrial()`;
  `AuthManager.fetchProfile()` stops reading `trial_ends_at`.
- `BillingPage.tsx`: trial end date renders from
  `entitlements.trialEndsAt` instead of the user store.
- Enumerate remaining `hasFreeTrial`/`trialEndsAt` readers during
  implementation (known: BillingPage only; Step 1 already migrated the
  entitlement gates).

**Owner-implicit fallout: none by design.** The server synthesizes the
owner's `role: 'admin'` into `workspace-list` items and the `workspace-get`
members blob, so `WorkspaceDropdown`'s `isAdmin` gate and MembersPage render
unchanged. The owner **stays visible in the members table but is not
editable there** — the existing treatment already delivers this (decided
2026-09-01): `isPlanOwner` keys off `owner_id` (`MembersPage.tsx:142-143,
450`), which renders the "Plan Owner" badge, the role as static muted text
instead of the role dropdown (`:211-213`), and no remove menu. Keep exactly
that; no new UI.

## 7. Intentional behavior changes

1. **One-way door closes the Step 1 interim edge**: a workspace with a
   canceled/lapsed subscription and a still-live trial window derived `trial`
   until now — it now derives `free`.
2. **New signups get their workspace at signup** (with `created_at + 7d`
   trial); first dashboard load no longer creates anything.
3. **The gap cohort** (post-regression signups, NULL profile trial) formally
   gains a trial that ended at migration time — behaviorally still free, but
   primed for Step 3's self-serve extension (count = 0).
4. `/workspace-create` returns 404; existing multi-workspace owners keep
   their extra workspaces (grandfathered), each with its own trial state.
5. Deleting an auth user now cascades their owned workspaces and memberships
   (previously orphaned rows).
6. `/user-profile-get` no longer returns `trial_ends_at`.
7. Secondary owned workspaces of a trial owner remain in trial (verbatim
   copy) — preserves the interim behavior; their windows tick independently
   from now on.
8. **Owners disappear from `workspace_members`** — the table now means
   "invited members". Owner rights (admin everywhere, unremovable, role
   locked) are structural via `workspaces.owner_id`; the member-remove 409
   guard survives as a friendlier error but nothing depends on it. Member
   listings still show the owner (synthesized server-side).
9. Inviting the workspace owner's own email is now explicitly rejected
   (previously impossible for a different reason — the owner had a row that
   tripped "already a member").

## 8. Testing

Server (`server/test/`, vitest — unit + real-Postgres e2e tier):

- **Derivation matrix** (`entitlements.test.ts`): add one-way-door rows —
  every non-pro status (`canceled`, `inactive`, `incomplete`, `unpaid`) with a
  future trial date ⇒ `free`; no-row + future trial ⇒ `trial` with
  `trialEndsAt` set; payload has `trialEndsAt: null` for free/pro.
- **Trigger e2e**: inserting an `auth.users` row yields profile + workspace
  ("My Workspace", trial ≈ now+7d, extension count 0) + `default_workspace_id`
  and **no `workspace_members` row** — this replaces `workspace-get-default`'s
  bootstrap tests, which become trigger tests.
- **Owner-implicit coverage**: `isWorkspaceAdmin`/`isWorkspaceMember` true
  for owners without rows; `workspace-list`/`workspace-get`/`-get-default`
  return the owner with synthesized `role: 'admin'`; members blob has the
  owner first; seat floor = members + 1; inviting the owner's email ⇒
  rejected. Existing suites that seed the owner as an explicit member
  (`workspaceCreate.test.ts:84-88` assertion dies with the route;
  `workspaceMemberRemove.test.ts`, `stripePortal.test.ts` setups) align with
  the new model — owner seeds removed, assertions updated.
- **`seedAuthUser` fallout**: every e2e suite user now arrives with an owned
  workspace. Audit suites that assume "user with no workspace" or that seed
  their own and expect it to be the only/oldest one; `deleteAuthUsers`
  cleanup can lean on the new cascades (helper comment updated).
- **Migration smoke**: live profile trial copied to all owned workspaces;
  NULL profile trial ⇒ `trial_ends_at` ≈ migration time; users with zero
  workspaces get one created with default pointer; existing owner membership
  rows deleted, invited-member rows untouched; `trial_ends_at` NOT NULL
  holds.
- **`subscriptionGet` e2e**: the existing trial test switches its setup from
  `user_profiles.trial_ends_at` to `workspaces.trial_ends_at`; new case —
  canceled subscription + live workspace trial ⇒ free entitlements.
- **`workspace-get-default` e2e**: stored-default heal and oldest-owned
  fallback unchanged; user with no owned workspace (seed then hard-delete the
  workspace) ⇒ 500.
- **Fake-clock pitfall** (Step 1 §13): fakeClock is pinned at 2026-01-01 —
  trigger-created workspaces get real `now()+7d` trials, so trigger-made
  users read as *on trial* under fakes. Entitlement-state tests must pin
  `workspaces.trial_ends_at` explicitly (as Step 1 did for profiles).

Webapp: typecheck catches the removed `UserProfile.trial_ends_at` and
`workspace-create` contract entries; extension typecheck + build (no trial
code there, verified).

## 9. Implementation order

1. Shared types (`entitlements.ts` + `session.ts` + `workspaces.ts`/`index.ts`).
2. Migration + `supabase/sql/` mirror files (function/trigger rename, tables
   doc) + `seed.sql`.
3. Server: owner-implicit access (`projectAccess` helpers first — they carry
   most routes — then the inline sites), entitlements swap,
   `workspaceGetDefault` simplification, `workspaceCreate` deletion,
   `userProfileGet` trim, owner-invite guard.
4. Tests: derivation matrix, trigger e2e, owner-implicit coverage, migration
   smoke, suite audit for the new auto-created workspaces.
5. Webapp: affordance removal, store/BillingPage trial swap.
6. Deploy: migration → server → webapp back-to-back. No env var changes.

## 10. Out of scope (later steps)

- Trial banner/countdown, extension endpoint + review-ask popup, manual grant
  path (Step 3) — `trial_extension_count` ships now but nothing writes it.
  Until Step 3 lands, the ends-today cohort can't self-extend; acceptable,
  they're free today anyway.
- Project cap enforcement + expiry removal (Step 4).
- Physical drop of `user_profiles.trial_ends_at`, the `plan` column, and any
  remaining cleanup (Step 8).
- Workspace ownership transfer / deletion UI — permanently out (parent §8).

## 11. Implementation notes (2026-09-01)

Shipped as designed, with these divergences:

- **Trigger/function live in `sql/`, not the migration.** Per
  `supabase/CLAUDE.md`, migrations are schema-only; SQL functions/triggers
  deploy via `sql/deploy.sh`. So the rename shipped as
  `sql/functions/user_signup_bootstrap.sql` +
  `sql/triggers/on_user_signup_bootstrap.sql` (old pair deleted, dropped via
  `graveyard.sql` — deploy graveyard + new trigger together or signups
  double-insert profiles). The migration
  (`20260901131117_workspace_trial_signup.sql`) carries columns, backfills,
  owner-row deletion, and FK cascades only.
- **`AuthManager.fetchProfile()` deleted entirely** — its only job was
  syncing the profile trial to the user store. `/user-profile-get` now has
  no webapp caller (route kept; returns `{ name }`).
- **Test helpers:** `seedAuthUser` deletes the trigger-created workspace by
  default (`keepBootstrapWorkspace: true` opts in) so suites keep their
  "user with no workspace yet" semantics; `seedWorkspace` pins
  `trial_ends_at` to 2020-01-01 by default (expired even against the
  2026-01-01 fakeClock) so seeded workspaces read free unless a test opts
  into a trial.
- **`supabase/seed.sql`** workspaces now pin explicit `trial_ends_at`
  values mirroring the old profile trials (user1 expired, user2 live,
  user3 ends-now); owner membership rows removed from the seed.
- Applied and verified against the local DB: migration + `sql/deploy.sh`;
  backfill checks (0 owner member rows, 0 NULL trials), trigger smoke
  (workspace + profile + 7-day trial, no member row), owner-deletion
  cascade.

Deploy checklist (not yet done): run the migration against prod, run
`sql/deploy.sh --remote` (graveyard drops the old trigger, deploys the new
one) in the same window, then deploy server → webapp back-to-back. No env
var changes.
