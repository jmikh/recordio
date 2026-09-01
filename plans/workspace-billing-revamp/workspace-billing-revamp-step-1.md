# Step 1 — Single Plan + Server-Side Entitlements Service

**Status:** Implemented 2026-09-01 — full server suite green (incl. real-Postgres
e2e tier), webapp + extension typecheck and build. Divergences from this design are
in §13 (Implementation notes) and mirrored in the parent doc's Step log.
**Parent:** [`workspace-billing-revamp-tiered-plan.md`](workspace-billing-revamp-tiered-plan.md)
(Step 1). Read that doc first — the entitlement matrix, decision log, and step
ordering live there.

**Goal:** Collapse Pro vs Teams into a single per-seat plan and centralize all tier
checks in one server-side entitlements module that every gated route consults. The
client stops computing entitlements and reads them from the server.

---

## 1. Decisions (resolved from the parent doc's open questions)

| Question | Decision |
|---|---|
| Stripe price migration | **Reuse the existing Pro prices** ($15/mo, $12/mo-yearly) as *the* per-seat price. Existing Pro subscribers are already on it — zero migration. Teams prices retire from config; the existing Teams subscriptions stay untouched in Stripe until Step 8 migrates them. |
| Entitlements delivery | **Extend `/subscription-get`** — response becomes `{ subscription, entitlements }`. One bootstrap fetch, fits the existing AuthManager → workspace-store flow. |
| Trial source (pre-Step-2) | **Workspace owner's `user_profiles.trial_ends_at`** — matches what the client's `useNonFreeAccess` already does, so no behavior change. Step 2 swaps the source to `workspaces.trial_ends_at` behind the same function. |
| Enforcement scope | **All four gates enforce in Step 1**: `/project-share`, `/render-job-create`, `/mux-video-create`, `/transcribe`. Safe because free users can't reach these via UI today. Rate limits + download UX redesign stay in Step 5. |

## 2. Current state (verified in code)

- `subscriptions`: PK `workspace_id`, `plan TEXT NOT NULL DEFAULT 'pro'`
  (CHECK `pro|teams`, migration `20260511225655`), `seats INTEGER` nullable, and
  a seats-only-on-teams constraint. (Found during implementation: the live
  constraint is `subscriptions_seats_teams_only` from migration `20260513121811`,
  which renamed the original `subscriptions_seats_business_only` of
  `20260512133917` — the migration below drops both names defensively.)
- Four price env vars in `server/src/config.ts:21-24` (pro/teams × monthly/yearly),
  wired into `app.deps` as `priceIds` in `server/src/server.ts:81-84`.
- Webhooks (`server/src/routes/billing/stripeWebhooks.ts`) derive `plan` from
  `price.metadata.plan_type` (throws if missing) and only populate `seats` for teams.
- The only server-side tier gate is `/transcribe`
  (`server/src/routes/transcribe.ts:165-175`): membership JOIN + status ∈
  `active|trialing`. `/project-share`, `/render-job-create`, `/mux-video-create`
  check auth/owner/editor only.
- `projectCreateV2.ts` sets `expires_at = +14d` unless status ∈ `active|past_due`
  (inconsistent with transcribe's `active|trialing`). Untouched here — Step 4
  replaces expiry with the project cap.
- Client: `useNonFreeAccess()` = subscription `active|past_due` OR profile trial in
  future. Call sites: `Header.tsx:63` (publish), `DashboardPage.tsx:36` (restore
  gate), and `CaptionsSettings.tsx:64` which checks `hasActivePlan` only
  (trial excluded — drift bug).
- Bootstrap: `AuthManager` → `/subscription-get` (+ `/user-profile-get` for
  `trial_ends_at`) → `useWorkspaceStore.setSubscription()` / `useUserStore`.
  Callers of `/subscription-get`: `AuthManager.ts`, `switchWorkspace.ts`,
  `BillingPage.tsx`. The extension does not call it.

## 3. Data changes

One migration — shipped as
`supabase/migrations/20260901095520_subscription_single_plan.sql`:

```sql
-- Single plan: every subscription is per-seat with seats >= 1.
-- Drops BOTH constraint names (the _teams_only rename and the original).
ALTER TABLE public.subscriptions
    DROP CONSTRAINT IF EXISTS subscriptions_seats_teams_only;
ALTER TABLE public.subscriptions
    DROP CONSTRAINT IF EXISTS subscriptions_seats_business_only;

UPDATE public.subscriptions SET seats = 1 WHERE seats IS NULL;

ALTER TABLE public.subscriptions
    ALTER COLUMN seats SET NOT NULL,
    ALTER COLUMN seats SET DEFAULT 1;

ALTER TABLE public.subscriptions
    DROP CONSTRAINT IF EXISTS subscriptions_seats_min;
ALTER TABLE public.subscriptions
    ADD CONSTRAINT subscriptions_seats_min CHECK (seats >= 1);
```

- **`plan` column stays physically** but no code reads or writes it after this
  step (inserts fall back to the `'pro'` default). Physical drop + CHECK removal
  happens in Step 8 with the rest of the cleanup.
- Update the per-table doc in `supabase/tables/` if one exists for subscriptions.

## 4. Stripe changes

**Prices / config**
- `STRIPE_PRO_PRICE_ID_MONTHLY/YEARLY` are renamed to
  `STRIPE_PRICE_ID_MONTHLY/YEARLY` (same underlying Stripe prices — env rename
  only; update local `.env` and prod deploy config in the same release).
- `STRIPE_TEAMS_PRICE_ID_MONTHLY/YEARLY` removed from `config.ts` and `deps.priceIds`
  (which shrinks to `{ monthly, yearly }`). The Stripe Teams price objects are
  archived in the dashboard, not deleted — existing Teams subs reference them
  until Step 8.
- No Stripe metadata changes needed: webhooks stop reading `price.metadata.plan_type`
  entirely (see below), so old/new prices both work.

**`/stripe-checkout`** (`routes/billing/stripeCheckout.ts`)
- Request body drops `plan` and `seats`. Keeps `interval` (`monthly|yearly`,
  default yearly).
- Quantity is always **1** (upgrade-first: the owner buys their own seat;
  auto-scaling on invite acceptance is Step 6).
- Session metadata shrinks to `{ userId, workspaceId, interval }`.

**`/stripe-webhooks`** (`routes/billing/stripeWebhooks.ts`)
- Stop deriving/writing `plan` in all three handlers (the throw-on-missing
  `plan_type` guard goes away).
- `seats` = the subscription item's `quantity`, unconditionally, in
  `checkout.session.completed` and `customer.subscription.created|updated`.
- `customer.subscription.deleted`: keep setting `status='canceled'`; write
  `seats = 1` instead of `plan='pro', seats=NULL` (seats is NOT NULL now).
- Ordering guard / no-ledger design unchanged.

**`/subscription-change`** (`routes/billing/subscriptionChange.ts`)
- `newPlan` removed from the request; the route now only changes `newSeats` and/or
  `newInterval` on the single price. All existing validations stay (admin, active
  status, no interval downgrade, no-op guard, seat floor ≥ member count).
- This remains the *only* legitimate seat-change path until Step 6 replaces manual
  seat management with invite-driven auto-scaling.

**`/workspace-seats-set`** (`routes/workspaces/workspaceSeatsSet.ts`)
- **Removed in this step**, ahead of the Step 6 schedule. Rationale: it updates
  `subscriptions.seats` in the DB *without touching Stripe*; once seats always
  mean billed quantity, a DB-only write is a billing-integrity hole, and its one
  caller (`MembersPage.tsx:314`) can call `/subscription-change` instead (which
  does Stripe + DB correctly). Delete route, shared contract entry
  (`shared/api/workspaces.ts`, `shared/api/index.ts`), and the MembersPage call.

## 5. The entitlements module

**Location:** `server/src/services/entitlements.ts` (peer of `projectAccess.ts`,
`renderJobs.ts`). Plain module over `Db` + `Clock` — not a port; there's no
external system behind it.

**Shared payload type:** `shared/api/entitlements.ts` (used by the server route
schema and the webapp store):

```ts
export type WorkspaceEntitlementsState = 'free' | 'trial' | 'pro';

export interface WorkspaceEntitlements {
    state: WorkspaceEntitlementsState;
    canShare: boolean;
    canTranscribe: boolean;
    canBackgroundExport: boolean;
    can4k: boolean;
    canInvite: boolean;
    /** null = uncapped */
    projectCap: number | null;
}
```

(The parent doc sketched `max4k`; `can4k: boolean` is clearer — export resolution
enforcement mechanics land in Step 5, the flag ships now.)

**API:**

```ts
export async function getWorkspaceEntitlements(
    db: Db, clock: Clock, workspaceId: string,
): Promise<WorkspaceEntitlements>
```

One query:

```sql
SELECT s.status, up.trial_ends_at
FROM workspaces w
LEFT JOIN subscriptions s ON s.workspace_id = w.id
LEFT JOIN user_profiles up ON up.user_id = w.owner_id
WHERE w.id = $1 AND w.deleted_at IS NULL
```

**State derivation** (pure function, unit-testable without a DB):
- `pro` if status ∈ `active | past_due | trialing` — `past_due` = full access
  during dunning (parent doc); `trialing` tolerated for Stripe-side trials even
  though we don't create them.
- else `trial` if `trial_ends_at` > now (owner's profile trial; Step 2 swaps this
  input to `workspaces.trial_ends_at`).
- else `free`.

Accepted interim edge (decided 2026-09-01, parent §3 "one-way door"): a lapsed
subscription with a still-live trial window falls back to `trial` here. Once a
workspace has been pro it should never derive `trial` again — enforced in Step 2
when the trial moves onto the workspace; not worth special-casing the interim
owner-profile source.

**Capability matrix** (from the parent doc §2):

| | free | trial | pro |
|---|---|---|---|
| canShare | no | yes | yes |
| canTranscribe | no | yes | yes |
| canBackgroundExport | no | yes | yes |
| can4k | no | yes | yes |
| canInvite | no | no | yes |
| projectCap | `FREE_PROJECT_CAP` (module const, start 3) | null | null |

`projectCap` and `canInvite` are **computed and returned but not yet enforced** —
enforcement lands in Steps 4 and 6 respectively. Ship the values now so the
client reads one stable payload from day 1. Exact cap N is finalized in the
Step 4 doc; the constant makes it a one-line change.

**Caching: none.** One indexed single-row query per gated request against the
same pool every route already uses — measure before caching. The client caches
in its store (refreshed on bootstrap, workspace switch, and post-checkout
`refreshSubscription()`), same staleness profile as today.

**Rejection convention:** gated routes respond
`403 { error: 'subscription_required' }`. `/transcribe`'s existing
`'Active subscription required'` string changes to match; the client keys off
status 403, not the string.

## 6. Route enforcement wiring

All four keep their existing auth/membership/owner/editor checks and add one
entitlements check after resolving the project's/target's `workspace_id`:

| Route | Flag | Notes |
|---|---|---|
| `/project-share` | `canShare` | add `workspace_id` to the project select |
| `/mux-video-create` | `canShare` | it's share plumbing (parent doc §3) — gate with the share flag |
| `/render-job-create` | `canBackgroundExport` | request has no resolution param (`{projectId, cloudVersion}`), so `can4k` has nothing to check here — 4k enforcement is Step 5 |
| `/transcribe` | `canTranscribe` | replaces the inline `active|trialing` status query; membership JOIN stays |

Delete the stale "Pro subscription" comment note in `renderJobCreate.ts`'s header
while touching it.

## 7. Shared contract changes

`shared/api/session.ts`:
- `SubscriptionInfo` drops `plan` (and its `'pro' | 'teams'` union import chain).
- New response type:

```ts
export interface SubscriptionGetResponse {
    /** null = no subscription row (free or trial workspace) */
    subscription: SubscriptionInfo | null;
    entitlements: WorkspaceEntitlements;
}
```

- `/subscription-get` keeps its request shape and member-gating, but the
  response is no longer nullable: members always get entitlements (a trial/free
  workspace is `subscription: null` + real entitlements). Non-members get 403
  (today they get `null`, indistinguishable from free — with entitlements in the
  payload that ambiguity has to go).
- `shared/api/index.ts`: update the `subscription-get` entry; remove
  `workspace-seats-set`.

**Deploy-skew note:** stale webapp bundles calling the new server will read the
wrapper object as a subscription blob, find no `status`, and render free-tier UI
until reload (server still allows their actions — nothing breaks server-side).
Accepted: deploy server then webapp back-to-back; current user count makes the
window a non-issue. Not worth a parallel versioned route — `/subscription-get`
would only be graveyarded in Step 8 anyway.

## 8. Frontend changes

**Store** (`webapp/src/workspace/useWorkspaceStore.ts`):
- `WorkspaceSubscription` drops `plan`; store gains
  `entitlements: WorkspaceEntitlements | null` set alongside `setSubscription()`
  from the new payload. Not-yet-loaded ⇒ treat as free (all flags false).
- `hasActivePlan` survives only if something still needs raw
  subscription-active state after the migration below; expected outcome is that
  it's deleted.

**Hook:** `useNonFreeAccess.ts` is deleted, replaced by
`webapp/src/billing/useEntitlements.ts` returning the store's entitlements
(free-shaped default). Call-site migration:

| Call site | Today | Becomes |
|---|---|---|
| `Header.tsx:63` (publish/share) | `useNonFreeAccess()` | `entitlements.canShare` |
| `DashboardPage.tsx:36/448` (restore gate) | `!useNonFreeAccess()` | `state === 'free'` — restore isn't in the parent matrix; preserve behavior, revisit in Step 4 when expiry (the reason trash gating exists) is removed |
| `CaptionsSettings.tsx:64` | `hasActivePlan` (trial wrongly excluded) | `entitlements.canTranscribe` — **fixes the drift bug; trial users gain transcription UI**, matching the target matrix and the new server gate |
| `DownloadModal.tsx:138-154` (cloud button) | `hasNonFreeAccess` | `entitlements.canBackgroundExport` — modal itself is redesigned in Step 5, only the flag source changes now |

**AuthManager / switchWorkspace / BillingPage:** consume the new
`{ subscription, entitlements }` shape; `fetchProfile()`/`trial_ends_at` display
logic unchanged (banner/countdown work is Step 3).

**Billing UI:**
- `BillingPage.tsx`: single-plan layout — remove the Teams column/toggle and the
  pro-vs-teams feature table (becomes free-vs-pro from the parent §2 matrix);
  pricing constants stay $15/mo, $12/mo-yearly, now labeled per seat; seat count
  shown from `subscription.seats`; plan derivation from `subscription.plan` goes
  away (state comes from `entitlements.state`).
- `StripeService.ts`: drop `plan`/`seats` params from checkout + change calls.
- `MembersPage.tsx`: the "set up team access" seat panel (the only
  `/workspace-seats-set` caller) is deleted outright — it was only reachable when
  `seats` was NULL, which can't happen once seats are NOT NULL. Seat management
  lives in the BillingPage stepper (which uses `/subscription-change`). The
  Teams-plan upsell copy becomes "Adding team members is a Pro feature".

**Dev override:** `VITE_DEV_PRO_UID` currently fakes `hasActivePlan` client-side.
Keep it as a client-side entitlements override (forces pro-shaped flags) so UI
dev flows still work; server gates in dev use real local-DB state.

## 9. Intentional behavior changes

1. Free users calling `/project-share`, `/render-job-create`, `/mux-video-create`
   directly (API, not UI) now get 403 — previously unenforced.
2. Product-trial users gain transcription (server previously only accepted
   Stripe `active|trialing`; the profile trial didn't count — now `trial` state
   grants `canTranscribe`).
3. `/subscription-get` non-members: `null` → 403.
4. `plan` disappears from the wire; existing Teams subscribers' UI shows the
   single plan with their seat count (their Stripe subscription is untouched
   until Step 8).
5. Manual DB-only seat setting (`/workspace-seats-set`) is gone; seat changes go
   through `/subscription-change` (Stripe-backed, prorated).

## 10. Testing

Server (`server/test/`, vitest):
- Entitlements derivation matrix: every status × trial combination → state, and
  state → flags (pure-function tests, no DB).
- Each of the four gated routes: free ⇒ 403 `subscription_required`, trial ⇒
  allowed (share/render/mux/transcribe), pro ⇒ allowed; membership/owner checks
  still enforced first.
- Webhooks: seats always mirrors quantity; deletion writes `seats = 1`; no
  `plan_type` metadata required.
- Checkout: quantity always 1; body without `plan`/`seats` validates.
- `/subscription-get`: member of free/trial workspace gets
  `{ subscription: null, entitlements }`; non-member gets 403.
- Migration smoke: seats backfilled to 1, `seats >= 1` constraint rejects 0/NULL.

Webapp: existing flows compile against the new shared types (the type-drop of
`plan` makes stale readers a build error, which is the point).

## 11. Implementation order

1. Migration + shared types (`entitlements.ts`, session/workspaces/index updates).
2. Entitlements service + unit tests.
3. Server: webhook/checkout/subscription-change simplification, seats-set
   removal, four route gates, `/subscription-get` payload. Config env rename.
4. Webapp: store/hook migration, call sites, BillingPage/StripeService/
   MembersPage.
5. Deploy: server → webapp back-to-back; update prod env vars
   (`STRIPE_PRICE_ID_*`, remove teams IDs) with the server deploy.

## 12. Out of scope (later steps)

- Workspace-level `trial_ends_at`, signup-time workspace creation (Step 2);
  extension flow (Step 3).
- Project-cap **enforcement** + expiry removal (Step 4) — the payload field ships now.
- 4k/rate-limit enforcement, one-button download UX, share-triggers-render (Step 5).
- Invite gating (`canInvite` enforcement), seat auto-scaling on accept/remove (Step 6).
- Lapse state machine details, pending-invite revocation (Step 7).
- Teams→single-plan Stripe migration, `plan` column drop, `is_personal`,
  remaining cleanup (Step 8).

## 13. Implementation notes (2026-09-01)

Shipped as designed, with these divergences (also logged in the parent doc):

- **Constraint name**: the live seats constraint was `subscriptions_seats_teams_only`
  (migration `20260513121811` renamed the original); the shipped migration drops
  both names (§3 updated to match).
- **MembersPage**: instead of repointing the "set up team access" panel at
  `/subscription-change`, the panel was removed entirely — it was dead code once
  `seats` can't be NULL (§8 updated to match).
- **`projects.workspace_id` is never NULL** (per user) — the gates read it
  directly with no legacy-null fallback; `getProjectIfEditor` now also returns it.
- **Fake-clock pitfall for tests**: the server test fakeClock is pinned at
  2026-01-01, before the seeded users' NOW()-relative `trial_ends_at` — so seeded
  users read as *on trial* under fakes. Entitlement-state tests use dedicated
  `seedAuthUser` owners (trial NULL = free; explicitly pinned date = trial).

Verification: 640 server tests green via the root vitest config (unit + real-Postgres
e2e), including new gate 403s, trial/past_due transcribe grants, webhook
seats-from-quantity, and the new `/subscription-get` contract; webapp + extension
`tsc` + vite dev builds pass. Pre-existing failures unrelated to this step:
`test/integration/*` (tests the graveyarded Supabase edge-fn/RPC stack) and one
stale `cloudProjectService.test.ts` assertion — recorded in
[`workspace-billing-revamp-agent-suggestions.md`](workspace-billing-revamp-agent-suggestions.md).

Deploy checklist (not yet done): update Railway env (`STRIPE_PRICE_ID_MONTHLY/YEARLY`
renamed from `STRIPE_PRO_PRICE_ID_*`, delete `STRIPE_TEAMS_PRICE_ID_*`), run the
migration against prod, deploy server then webapp back-to-back.
