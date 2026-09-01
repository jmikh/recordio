# Step 3 — Trial Extension Flow

**Status:** Planned 2026-09-01.
**Parent:** [`workspace-billing-revamp-tiered-plan.md`](workspace-billing-revamp-tiered-plan.md)
(Step 3). Read that doc first — the entitlement matrix, decision log, and step
ordering live there.

**Goal:** One self-serve trial extension: when a never-pro workspace's trial has
ended and no extension has been used, every upgrade surface offers an "extend
trial" hyperlink; clicking it grants +7 days on the spot and then (grant first,
ask after) shows a success message inviting a Chrome Web Store review. No
banner, no email path, no manual-grant mechanism.

---

## 1. Decisions (resolved from the parent doc's open questions + 2026-09-01 chat)

| Question | Decision |
|---|---|
| Eligibility | **Trial already ended + `trial_extension_count = 0` + never-pro (one-way door) + caller is the workspace owner.** No mid-trial extension — with "+7d from extension date" semantics, extending early would waste remaining time, so both the CTA and the endpoint refuse until the trial has lapsed. Owner-only costs nothing (free/trial workspaces are solo) and keeps grandfathered multi-member edge cases out. |
| Delivery to client | **`canExtendTrial: boolean` on `WorkspaceEntitlements`** (decided in chat — boolean, not an enum: with the email path dropped there are only two client states, show the link or don't). True ⇔ the eligibility predicate above minus the owner check (which the endpoint enforces). |
| Email path / manual grant | **Dropped from the product** (decided 2026-09-01, supersedes parent §3's email-to-john CTA). After the one extension the CTA simply disappears. Any future "reach out for more time" offer lives outside the product (landing page / support policy) — problem for another day. Nothing for John to grant ⇒ no manual-grant mechanism to build. |
| CTA form | **No banner/countdown UI.** Wherever there is an upgrade option, there is an "extend trial" hyperlink (gated on `canExtendTrial`). Known surfaces today: `ProUpgradeModal`, `ProGate` tooltip, BillingPage free-plan card. The extension doubles as a **review-conversion mechanism**: the post-grant success modal asks for a Chrome Web Store review. |
| Trial-end moment | **No modal.** Locked features already show the Step 1 gate treatments (ProGate / ProUpgradeModal); those same surfaces now carry the extension offer. BillingPage's existing "Trial ends {date}" line (Step 2) remains the only countdown. |
| Existing share links after trial ends | **Stay live** (parent lean adopted). Creating/updating shares is already blocked by `canShare`; the public watch path has no entitlement gate. Verify during implementation and pin with a regression test — no code change expected. |
| Extension semantics | `trial_ends_at = extension time + 7 days` (literally from the extension date, per parent §3), `trial_extension_count += 1`, as **one atomic conditional UPDATE** — the guards live in the WHERE clause, so double-clicks and concurrent requests can never double-grant (the plan's idempotency requirement). The extension timestamp is `clock.now()` passed as a SQL parameter, not SQL `now()`, so fakeClock governs in tests. |

## 2. Current state (verified in code, 2026-09-01)

- **Columns exist, nothing writes them.** `workspaces.trial_ends_at`
  (TIMESTAMPTZ NOT NULL, default `now() + 7 days`) and
  `trial_extension_count` (INTEGER NOT NULL DEFAULT 0) shipped in Step 2
  (migration `20260901131117_workspace_trial_signup.sql`;
  `supabase/sql/tables/workspaces.sql`). The gap cohort was backfilled with
  `trial_ends_at =` migration time and count 0 — this step is their on-demand
  trial grant.
- **Entitlements** (`server/src/services/entitlements.ts`):
  `deriveEntitlementsState` already implements the one-way door (any
  subscription row ⇒ never trial; rows retained as `canceled` ⇒ row-exists ⇔
  ever-pro). `getWorkspaceEntitlements` selects `s.status, w.trial_ends_at`
  only — `trial_extension_count` is not yet read. Payload
  (`shared/api/entitlements.ts:14-32`) already carries `trialEndsAt`.
- **No trial-extend anything yet**: no endpoint, no `canExtendTrial`, no UI
  (grep-verified).
- **Route pattern** to copy: `server/src/routes/billing/subscriptionGet.ts` —
  `FastifyPluginAsyncTypebox`, `preHandler: app.requireUser`, Typebox
  body/response schemas, registered in `app.ts` (~line 161-210), contract in
  `shared/api/session.ts` + `shared/api/index.ts`.
- **Upgrade surfaces** (where the link goes):
  - `webapp/src/billing/ProUpgradeModal.tsx` — 360px modal, "Upgrade" →
    billing page; opened from the editor Header share gate
    (`webapp/src/editor/components/header/Header.tsx:321-349`) and others.
  - `webapp/src/pages/dashboard/ProGate.tsx` — dimmed-child wrapper with
    hover tooltip "Upgrade to use {feature}" + "Upgrade →" link.
  - `webapp/src/pages/settings/BillingPage.tsx` — free-plan card; also
    renders the trial countdown from `entitlements.trialEndsAt` (:210-213).
- **Review plumbing to reuse**: `CHROME_EXTENSION_URL` in `shared/urls.ts:11`
  (reviews page = `${CHROME_EXTENSION_URL}/reviews`); existing
  `ReviewModal` (`webapp/src/editor/components/header/ReviewModal.tsx`) is a
  copy template only — different trigger/copy/one-time tracking; leave it
  alone. No `LocalPreferences` flag needed here: the success modal fires once
  per extension event by construction.
- **Client plumbing**: `useEntitlements`
  (`webapp/src/billing/useEntitlements.ts`) reads the workspace store;
  `FREE_ENTITLEMENTS` default (lines 5-14) must gain the new field.
  `AuthManager.refreshSubscription()` re-fetches `/subscription-get` after
  billing mutations — reuse after a successful extension.
- **Test helpers**: `seedWorkspace` pins `trial_ends_at = 2020-01-01`
  (expired) by default — never-pro seeds are `canExtendTrial`-true out of the
  box; fakeClock is pinned at 2026-01-01.

## 3. Data changes

**None.** Both columns shipped in Step 2. No migration, no env vars.

## 4. Server changes

**`services/entitlements.ts`** — the query adds `w.trial_extension_count`;
`entitlementsForState` gains a `canExtendTrial = false` parameter (default
keeps existing call sites valid), computed in `getWorkspaceEntitlements`:

```ts
// canExtendTrial: no subscription row (never-pro) AND trial over AND unused
const canExtendTrial =
    status === null &&
    trialEndsAt !== null && trialEndsAt <= now &&
    extensionCount === 0;
```

Header comment gains the Step 3 note.

**`routes/billing/trialExtend.ts`** (new) — `POST /trial-extend`, body
`{ workspaceId }`, `preHandler: app.requireUser`:

1. `SELECT owner_id, trial_ends_at, trial_extension_count FROM workspaces
   WHERE id = $1 AND deleted_at IS NULL` → 404 unknown; 403 when
   `owner_id !== userId` (members and strangers look the same — same
   information-hiding stance as `/subscription-get`'s 403).
2. The grant — all guards in the WHERE clause, `$2 = clock.now()`:

```sql
UPDATE workspaces w
SET trial_ends_at = $2::timestamptz + interval '7 days',
    trial_extension_count = trial_extension_count + 1
WHERE w.id = $1 AND w.deleted_at IS NULL
  AND w.trial_extension_count = 0
  AND w.trial_ends_at <= $2
  AND NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.workspace_id = w.id)
RETURNING trial_ends_at, trial_extension_count
```

3. Row updated → `getWorkspaceEntitlements` → **200
   `{ entitlements }`** (state now `trial`, fresh `trialEndsAt`,
   `canExtendTrial: false`).
4. Zero rows → **409 `{ error, reason }`** with `reason` derived from the
   step-1 read + a subscription-existence check:
   `'ever_pro' | 'already_extended' | 'trial_active'`. The client only needs
   "didn't happen" (it re-syncs entitlements); the reason is for
   logs/analytics.

Register in `app.ts` beside the other billing routes.

## 5. Shared contract changes

- `shared/api/entitlements.ts`: `WorkspaceEntitlements` gains
  `canExtendTrial: boolean` (doc comment: true only when the workspace's
  trial has ended unused and the workspace has never been pro).
- `shared/api/session.ts`: `trial-extend` request/response beside the
  `subscription-get` contract; entry in `shared/api/index.ts`.

## 6. Frontend changes

**`TrialExtendLink`** (new, `webapp/src/billing/`) — self-contained: renders
nothing unless `entitlements.canExtendTrial`; otherwise a small hyperlink
("or extend your free trial — 7 more days"). On click:

1. `invokeFunction('trial-extend', { workspaceId })`.
2. Success → `AuthManager.refreshSubscription()` (store now shows `trial`
   state; gates unlock live) → open **`TrialExtendedModal`**.
3. Failure → error toast + `refreshSubscription()` (the local
   `canExtendTrial` was stale); the link disappears with the fresh payload.

**`TrialExtendedModal`** (new) — `Modal` component, ReviewModal's layout as
template. Copy (grant first, ask after — the extension is already granted
before this renders, so the ask is unconditional per CWS policy):

> **Your trial has been extended for another week 🎉**
> If you're enjoying Recordio, it would mean a lot if you left a quick
> Chrome Web Store review — it only takes a few seconds.

Primary button opens `${CHROME_EXTENSION_URL}/reviews` (new tab); secondary
"Maybe later" dismisses. No `LocalPreferences` tracking.

**Surface placement** — add `TrialExtendLink` to:
- `ProUpgradeModal.tsx` (under the Upgrade button). On success, close the
  upgrade modal before showing the success modal.
- `ProGate.tsx` tooltip (beside "Upgrade →").
- `BillingPage.tsx` free-plan card.
- Audit for other upgrade CTAs during implementation — the rule is
  "wherever there is an upgrade option". Step 5's download upsell must
  include it when it lands (noted there-ward in §10).

**Plumbing:** `FREE_ENTITLEMENTS` in `useEntitlements.ts` gains
`canExtendTrial: false`. Analytics (`webapp/src/analytics/index.ts`
conventions): `trackTrialExtended`, `trackTrialExtendFailed(reason)`,
`trackTrialReviewCtaClicked`.

## 7. Intentional behavior changes

1. **The gap cohort gets its trial on demand**: backfilled ends-at-migration
   workspaces (count 0) see the extend link on every upgrade surface and can
   self-grant 7 days.
2. **No CTA during a live trial** — `canExtendTrial` is false until the trial
   lapses, so the from-extension-date semantics can never eat remaining time.
3. **After the one extension, the offer vanishes** — no email CTA (dropped),
   no further in-product path. Ever-pro workspaces never see the offer.
4. Share links created during a trial keep serving after it ends (existing
   behavior, now pinned by test); creating/updating shares stays
   `canShare`-gated.

## 8. Testing

Server (`server/test/`, vitest — validation tier + real-Postgres e2e):

- **`billing/trialExtend.test.ts`** — validation: 401 unauthenticated, 400
  bad body. E2e: 404 unknown workspace; 403 invited member (non-owner);
  success on expired-trial/count-0/never-pro ⇒ `trial_ends_at` =
  fakeClock now + 7d, count 1, response entitlements `state: 'trial'` with
  `canExtendTrial: false`; 409 `trial_active` (future `trial_ends_at`); 409
  `already_extended` (count 1); 409 `ever_pro` (seeded `canceled`
  subscription row); **race**: two concurrent calls ⇒ exactly one grant
  (count lands at 1, one 200 + one 409).
- **`entitlements.test.ts`** — `canExtendTrial` matrix: expired + count 0 +
  no row ⇒ true; live trial ⇒ false; count ≥ 1 ⇒ false; any subscription row
  (every status incl. `canceled`) ⇒ false; pro ⇒ false.
- **`subscriptionGet` e2e** — payload includes `canExtendTrial` (one
  assertion on an existing case).
- **Share-link persistence** — locate the public watch route, confirm no
  entitlement gate, add: project shared while on trial, `trial_ends_at`
  pinned past ⇒ watch route still serves.
- Fake-clock discipline (Step 2 §8): the endpoint takes `clock.now()` as a
  parameter, so tests never race DB `now()`; `seedWorkspace`'s default
  2020-01-01 trial makes never-pro seeds extension-eligible out of the box.

Webapp: typecheck (new contract + `FREE_ENTITLEMENTS` field), dev build.
Extension: typecheck + dev build (no trial code there — expect no-op).

## 9. Implementation order

1. Shared contract: `entitlements.ts` field, `trial-extend` request/response,
   `index.ts` entry.
2. Server: entitlements `canExtendTrial`, `trialExtend.ts` route + `app.ts`
   registration.
3. Tests: route suite, derivation matrix rows, subscriptionGet assertion,
   share-link persistence.
4. Webapp: `FREE_ENTITLEMENTS`, `TrialExtendLink` + `TrialExtendedModal`,
   surface placement, analytics.
5. Deploy: server → webapp back-to-back (no migration, no env changes; old
   webapp bundles simply never show the link — `canExtendTrial` absent ⇒
   falsy).

## 10. Out of scope (later steps / dropped)

- **Email extension path + manual-grant mechanism — dropped entirely**
  (2026-09-01). Future "reach out for more time" belongs to the website /
  support policy, not the product.
- **Trial banner/countdown — dropped** in favor of upgrade-surface links;
  BillingPage's existing trial line is the only countdown.
- Chrome-extension-side trial UI — none exists, none added.
- Step 5's download upsell surface — must include `TrialExtendLink` when it
  lands.
- Physical column drops and remaining cleanup (Step 8).
