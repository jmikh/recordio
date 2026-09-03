# Step 6 — Seats, Invitations & Checkout (auto-scaling billing)

**Status:** Implemented 2026-09-04 — full server suite green (533 tests: new
seatBilling service suite, invite/accept/remove/role-change gating + sync
pins, checkout e2e tier, portal authority split, webhook drift detector),
server + webapp typecheck, webapp + extension dev builds. Divergences from
this design are in §11 and mirrored in the parent doc's Step log.
Outstanding: manual browser smoke; prod deploy (server → webapp,
back-to-back — no migration).
Step 5 was deferred in Step 6's favor (2026-09-03 chat): the share/render
gates already went server-side in Step 1, so the gating pressure is low;
Steps 3–7 are parallelizable per the parent doc.
**Parent:** [`workspace-billing-revamp-tiered-plan.md`](workspace-billing-revamp-tiered-plan.md)
(Step 6). Read that doc first — the entitlement matrix, decision log, and step
ordering live there.

**Goal:** Kill seat pre-purchase. The owner upgrades with just their own seat
(checkout quantity = 1 in the common case); after that the bill scales by
itself — each accepted creator/admin invite bumps the Stripe quantity with
proration, removals and creator→viewer downgrades shrink it, viewers never
touch it. The manual seat stepper dies. Every quantity change emails the plan
owner.

---

## 1. Decisions (resolved from the parent doc's open questions + 2026-09-03 chat)

| Question | Decision |
|---|---|
| Race/failure handling between invite acceptance and Stripe update | **Quantity is derived state, never arithmetic.** Billed seats are always *computed* from the DB — `1 (owner) + creator/admin member rows` — and every seat-affecting event recomputes and **sets** the Stripe quantity to that value (no `+1`/`−1` deltas to drift). DB writes commit first; the Stripe sync runs after and **never blocks or reverts the membership change** — a join must not fail on a billing hiccup. A failed sync logs loudly and self-heals on the next seat event; the webhook handler additionally warns when Stripe's quantity disagrees with the computed count (drift detector, log-only). |
| Proration on seat add | **Invoice immediately** (`proration_behavior: 'always_invoice'`) — consistent with `/subscription-change` today. Each accepted invite produces one small prorated invoice; the seat-change email gives the charge its context. |
| Proration on seat removal | **Credit unused time** (decided 2026-09-03 chat): Stripe's default — the unused remainder lands as *account balance*, never a cash refund. Used months stay paid; the credit offsets the next renewal or the next seat addition (so swapping one member for another mid-term nets to ~zero). Accepted cost: yearly-discount arbitrage (add a seat for a month at 1/12 the yearly rate) — bounded at the 20% discount delta, Slack-style fair billing. |
| Viewer ceiling | **50** (hidden — never shown in product). At the ceiling the admin sees "Viewer limit reached — contact support to increase it." Config constant beside `FREE_PROJECT_CAP`, not an env var; raising it is invisible. Pending viewer invitations count toward it (otherwise it's trivially bypassed by mass-inviting). |
| Invite-form billing delta | **Static copy** (decided 2026-09-03 chat): "Each creator seat adds $15/mo (prorated from the day they join)" — price from the existing config constants, interval-aware. No live `previewInvoice` call per form render (rejected: Stripe round-trip + loading state for a number that's only accurate if accepted the same day). The exact prorated amount appears where it's real: the seat-change email and the Stripe invoice. |
| Seat-change notification | **Email only, to the plan owner, on every billed-quantity change** (decided 2026-09-03, recorded in parent §3): who joined/left and their role, new seat count, new recurring total, proration note. No in-app notification (rejected as needless complexity). Fire-and-forget — an email failure never fails the route. |
| Manual seat stepper | **Removed.** `/subscription-change` becomes interval-only (monthly↔yearly); the seat floor logic goes with it. BillingPage shows seats read-only: "N seats × $X = $Y/mo · seats adjust automatically as members join or leave." During the deploy window the server *accepts and ignores* a `newSeats` field from stale webapp bundles (log-warn); the field is deleted from the contract in Step 8. |
| Checkout quantity | **Computed, not hardcoded 1.** A workspace re-upgrading after a lapse keeps its members (Step 7 rule), so checkout must start at `computeBilledSeats`, which is 1 for the normal solo-owner upgrade anyway. |
| Accept-time lapse guard | An invitation to a workspace whose subscription is no longer pro **fails at accept** with a business error ("This workspace's subscription is no longer active"). Step 7 will revoke pending invites on lapse; this guard is the belt underneath it and ships now since we're in the route. |
| Over-provisioned grandfathered subs | Self-healing by design: a pre-revamp sub with `seats = 5` but 2 billed members snaps to the computed count on its first seat event (their bill *shrinks*). Intended; Step 8's migration handles the rest. |
| Billing & invite authority | **Admin/owner only, for both** (decided 2026-09-03 chat): invitations AND every billing mutation — checkout, Stripe portal, plan changes. Invites were already admin-gated server-side (`isWorkspaceAdmin`, owner implied); the UI gains explicit "only admins" notes for other roles. Billing had two real gaps found during planning: `/stripe-portal` was **member**-gated (any viewer could open the owner's portal — payment methods, cancel, invoices) and `/stripe-checkout` had **no workspace-relationship check at all**. Both become admin-or-owner (same predicate as `/subscription-change`). `/subscription-get` stays member-readable — entitlements are for everyone. |

## 2. Current state (verified in code, 2026-09-03)

- **`canInvite` is computed but unenforced** —
  `server/src/services/entitlements.ts:63`: `canInvite: state === 'pro'`
  (state `pro` includes `active | past_due | trialing`, so dunning keeps
  invite rights per parent §3). Comment at lines 20–23 marks enforcement as
  this step. No payload change needed.
- **`/workspace-invite`** (`routes/workspaces/workspaceInvite.ts`): admin-only
  + owner-email 409 guard; **no entitlement or seat checks of any kind**.
  Deletes + reinserts the `(workspace_id, email)` invitation row, then sends
  the invite email via `services/workspaceInviteEmail.ts` (failure = log
  warn, route still 200).
- **`/workspace-invite-accept`** (`workspaceInviteAccept.ts`): token+pending
  lookup, caller-email match, owner guard, member UPSERT (re-invite updates
  role), invitation → accepted, default-workspace switch. Sequential queries,
  **no transaction**; business failures are 200 + `{ error }` (AcceptInvitePage
  renders them).
- **`/workspace-member-remove`** (`workspaceMemberRemove.ts`): transfer live
  projects to the calling admin → strip `project_editors` → delete membership.
  (The transfer-to-self/other/delete *choice* is Step 7 — untouched here.)
- **`/workspace-member-update-role`** (`workspaceMemberUpdateRole.ts`):
  admin-only, owner locked, plain role UPDATE.
- **`/subscription-change`** (`routes/billing/subscriptionChange.ts`): seats +
  interval via `getSubscription(expandItemPrices)` → optional
  `previewInvoice` (dryRun) → `updateSubscription` with
  `proration_behavior: 'always_invoice'` → direct DB `seats` write (webhook
  stays authoritative on re-sync). Seat floor = member rows + 1, owner rows
  excluded (2026-09-03 hardening after the stale-owner-row bug).
- **Stripe port** (`ports/stripe.ts:79-97`, adapter `adapters/stripe.ts`):
  `createCheckoutSession`, `getSubscription`, `updateSubscription({items:
  [{id, quantity?, price?}], proration_behavior?})`, `previewInvoice`,
  `verifyWebhook`. No idempotency keys in use.
- **Webhook** (`routes/billing/stripeWebhooks.ts:240-303`):
  `customer.subscription.created|updated` syncs `seats = item.quantity` with
  the `stripe_event_at` ordering guard (lines 158–170); `deleted` → status
  canceled, seats 1.
- **Checkout** (`routes/billing/stripeCheckout.ts:86`): `quantity: 1`
  hardcoded. **No workspace authz**: only `userId === req.user.id` is
  checked (line 78) — any authenticated user can start a checkout against
  any `workspaceId`.
- **Portal** (`routes/billing/stripePortal.ts:55-68`): gated on
  *membership* (owner OR any member row, role ignored) — a viewer can open
  the owner's Stripe portal today. `/subscription-change` is the only
  billing route already admin-or-owner gated (lines 121–129).
- **Email**: Resend via `deps.email` (`adapters/email.ts`, from
  `Recordio Team <john@recordio.io>`); pattern = template fn in
  `server/src/emails/` + service fn in `server/src/services/` (see
  `workspaceInviteEmail`).
- **Webapp**:
  - `MembersSection.tsx`: two SeatPanels fed by `details.seats` +
    `details.viewer_seats` (server-computed `seats * 10`,
    `workspaceGet.ts:54-58`), `VIEWER_SEATS_PER_CREATOR = 10` client
    constant, `canInvite` = local availability math, "No {role} seats
    available. Upgrade seats →".
  - `BillingSection.tsx`: seat stepper (lines 244–328) with 500ms-debounced
    `subscription-change` dryRun preview; price constants $15/mo, $12/mo-
    billed-yearly at lines 18–19.
- **`/workspace-get`** (`workspaceGet.ts`): returns `seats` +
  `viewer_seats` (`seats * 10`) + members (owner synthesized, stale owner
  rows excluded as of 2026-09-03) + pending invitations.
- **Test plumbing**: fake Stripe deps (`test/fakes/`) already model
  subscriptions/prices/invoice previews (`subscriptionChange.test.ts`
  seeds them); fake email adapter records sends; e2e tier runs on real
  Postgres via root vitest config.

## 3. Data changes

**None.** No migration. `VIEWER_CEILING = 50` is a server constant.

## 4. Server changes

**`services/seatBilling.ts`** (new) — the heart of the step:

```ts
// 1 (owner) + creator/admin member rows; stale owner rows excluded
computeBilledSeats(db, workspaceId): Promise<number>

// Recompute-and-set. No-op unless the workspace has a Stripe-linked,
// non-canceled subscription. Reads the live subscription item; when
// item.quantity !== computed → updateSubscription(quantity: computed,
// proration_behavior: 'always_invoice') → direct DB seats write (webhook
// authoritative on re-sync) → sendSeatChangeEmail (fire-and-forget).
// NEVER throws: catches everything, logs via logCtx — membership changes
// must not fail on billing.
syncSeatQuantity(deps, workspaceId, change: SeatChangeContext, logCtx): Promise<void>
```

`SeatChangeContext` carries what the email needs: `{ kind: 'joined' |
'removed' | 'role_changed', memberEmail, memberName?, role }`.

**`routes/workspaces/workspaceInvite.ts`** — enforcement lands:
1. After the admin check: `getWorkspaceEntitlements` → `!canInvite` → 403
   `{ error: 'Inviting members requires an active subscription' }`.
2. Viewer invites only: `count(viewer member rows) + count(pending viewer
   invitations) >= VIEWER_CEILING` → 403
   `{ error: 'Viewer limit reached — contact support to increase it' }`.
   No creator-seat availability check exists anymore — that's the point.

**`routes/workspaces/workspaceInviteAccept.ts`**:
1. New guard after the owner check: workspace not `pro` → 200
   `{ error: 'This workspace's subscription is no longer active' }` (same
   business-error channel the page already renders).
2. The three DB writes (member upsert, invitation accepted, default-workspace
   switch) wrap in a transaction (they weren't — pre-existing gap, fix while
   here).
3. After commit, when the accepted role is creator/admin:
   `syncSeatQuantity(deps, workspaceId, { kind: 'joined', ... })`. Viewers
   skip it entirely.

**`routes/workspaces/workspaceMemberRemove.ts`** — after the membership
delete succeeds: `syncSeatQuantity(..., { kind: 'removed', ... })` when the
removed member's role was creator/admin (SELECT the role before deleting).

**`routes/workspaces/workspaceMemberUpdateRole.ts`** — after the UPDATE, when
the change crosses the viewer↔(creator|admin) boundary in either direction:
`syncSeatQuantity(..., { kind: 'role_changed', ... })`. admin↔creator skips
(both are seats). Viewer→creator promotions also re-check the entitlement
state is pro (a lapsed workspace must not grow its bill — mirrors the invite
gate).

**`routes/billing/subscriptionChange.ts`** — interval-only:
- `newSeats` accepted-and-ignored with a log warn (stale webapp bundles
  during the deploy window; contract field deleted in Step 8). The effective
  quantity in the interval-change `updateSubscription` call is
  `computeBilledSeats` — even here, quantity is derived.
- Seat floor check deleted (nothing user-supplied to floor anymore).
- dryRun preview kept for interval switches.

**`routes/billing/stripeCheckout.ts`** — two changes:
- Authz: caller must be admin-or-owner of `workspaceId` (the
  `/subscription-change` predicate: `w.owner_id = $2 OR EXISTS(member row
  with role = 'admin')`) → 403 otherwise. Closes the missing-check gap.
- `quantity: 1` → `quantity: await computeBilledSeats(...)`.

**`routes/billing/stripePortal.ts`** — the membership predicate tightens to
admin-or-owner (add `AND wm.role = 'admin'` to the EXISTS). Non-admin
members get 403 `'Requires admin role in this workspace'` — not a 404;
information-hiding buys nothing here since members already see the
subscription via `/subscription-get`.

**`routes/billing/stripeWebhooks.ts`** — in the `subscription.updated`
handler, after the sync: `item.quantity !== computeBilledSeats` → log warn
`seat quantity drift` with both numbers. Log-only; the next seat event heals.

**`emails/seatChangeEmail.ts` + `services/sendSeatChangeEmail.ts`** (new,
`workspaceInviteEmail` pattern) — to the workspace owner's auth email:
- Subject: `"{Name} joined {workspace} — your plan is now N seats"` (and
  removed/role-changed variants).
- Body: the change (who, role), new seat count, new recurring total (from the
  live subscription item's `unit_amount × quantity`, already fetched during
  sync — no price config duplication), proration line: add → "a prorated
  charge for the remainder of this period was invoiced today"; remove →
  "a prorated credit was applied to your account balance".

## 5. Shared contract changes

- `shared/api/workspaces.ts`: `viewer_seats` dropped from the
  `workspace-get` details shape (parent §3: no `seats * 10` anywhere
  user-visible) — `workspaceGet.ts` stops computing it.
- `shared/api/*` invite error strings above; no new endpoints, no
  entitlements payload change (`canInvite` already ships).
- `subscription-change` request: `newSeats` marked deprecated/optional
  (removed Step 8).

## 6. Frontend changes

**`MembersSection.tsx`** — the auto-scaling rework:
- Seat panels replaced by one summary line: `N seats · $X/mo` (billed
  creator/admin count incl. owner; price constant by interval) + "Seats
  adjust automatically as members join or leave." Viewer count shown plainly
  (no ceiling, no ×10 math); `VIEWER_SEATS_PER_CREATOR` deleted.
- Invite form enabled for any admin on an active sub (`hasTeamAccess`
  gate stays). Under it, the static delta copy: creator selected → "Each
  creator seat adds $15/mo, prorated from the day they join" ($12 when
  yearly); viewer selected → "Viewers are free."
- Non-admin members (the form is already hidden for them, silently) get an
  explicit note in its place: "Only workspace admins can invite members."
- "No seats available / Upgrade seats →" deleted. Server 403s (lapsed,
  viewer ceiling) surface as toasts with the server's message.

**`BillingSection.tsx`** — stepper (lines 244–328) deleted; read-only
`N seats × $X = $Y/{interval}` + the auto-adjust line. Interval switch UI
and its dryRun preview stay. The "Manage billing" (portal) button — today
shown to every member (line 236) — gains the `isAdmin` gate; non-admins
see "Only workspace admins can manage billing." in its place. Upgrade CTAs
(checkout) likewise render only for admins on billing surfaces.

Analytics: `trackSeatAutoScaled` is server-side territory (Axiom logs from
`syncSeatQuantity`); client adds nothing new.

## 7. Intentional behavior changes

1. Creator/admin invites no longer require pre-purchased seats — any admin
   on an active sub can invite; the bill grows on acceptance, not before.
2. Free/trial workspaces get a server-side 403 on invite (previously
   client-gated only — actual enforcement was absent).
3. Accepting an invite to a lapsed workspace now fails (previously joined
   silently).
4. Removing a creator/downgrading to viewer shrinks the bill with a balance
   credit (previously seats never changed without the manual stepper).
5. The manual seat stepper is gone; seats cannot be set directly anymore.
6. `viewer_seats` disappears from the workspace payload; the Teams-era
   "10 viewer seats per creator on Teams. Included free." copy dies with it.
7. Grandfathered over-provisioned subs snap down to their computed count on
   first seat event.
8. Non-admin members lose Stripe portal access (previously any viewer could
   open it — payment methods, cancel, invoices); checkout now requires
   admin/owner of the target workspace (previously unchecked).

## 8. Testing

Server (validation + real-Postgres e2e with fake Stripe/email):

- **`seatBilling.test.ts`** (new): `computeBilledSeats` matrix — owner only
  = 1; +creator = 2; +admin = 3; viewers ignored; stale owner row ignored
  (pin). `syncSeatQuantity`: quantity set to computed (not incremented);
  equal quantity → no Stripe call, no email; no subscription / canceled →
  no-op; Stripe failure → resolves without throwing, logs; email recorded
  with new count on success.
- **`workspaceInvite.test.ts`**: free workspace creator invite → 403;
  trial → 403 (trials never unlock collaboration); active → 200; past_due →
  200 (dunning keeps rights); viewer #50 blocked with the contact-support
  message; pending viewer invites count toward the ceiling.
- **`workspaceInviteAccept.test.ts`**: creator accept → member row + Stripe
  quantity 2 + DB seats 2 + one email; viewer accept → no Stripe call;
  lapsed workspace → business error, no member row; Stripe-failure
  injection → member row EXISTS, 200, no throw (the load-bearing case);
  re-invite role change on existing member syncs correctly.
- **`workspaceMemberRemove` / `workspaceMemberUpdateRole`**: creator removed
  → quantity 1; viewer removed → no call; creator→viewer → down;
  viewer→creator → up; viewer→creator on lapsed workspace → 403;
  admin→creator → no call.
- **`subscriptionChange.test.ts`**: `newSeats` ignored (quantity stays
  computed) + warn logged; interval change carries computed quantity; floor
  tests deleted.
- **`stripeCheckout`**: quantity = computed count (seed a member, expect 2);
  403 for a creator/viewer member and for a non-member of the target
  workspace; 200 for owner and admin member.
- **`stripePortal`**: 403 creator/viewer member; 200 owner + admin member;
  404 non-member unchanged.
- **Webhook**: drift warn fires on mismatched quantity; sync still applies.

Webapp: typecheck + dev build (contract change: `viewer_seats` removal).
Extension: typecheck + dev build (no billing code — expect no-op).

## 9. Implementation order

1. `services/seatBilling.ts` + `VIEWER_CEILING` + tests.
2. Route wiring: invite gate → accept (txn + guard + sync) → remove/update-
   role sync → checkout quantity → subscriptionChange interval-only →
   webhook drift warn. Tests per route.
3. Email template + service, threaded into `syncSeatQuantity`.
4. Shared contract: drop `viewer_seats`, deprecate `newSeats`.
5. Webapp: MembersSection + BillingSection rework.
6. Deploy: **server → webapp**, back-to-back (no migration). Old webapp
   against new server: stepper calls are ignored (log-warn), invite gating
   errors render as toasts — degraded but safe. Never the reverse order
   (new webapp's read-only seats against old server would strand seat
   changes entirely).

## 10. Out of scope (later steps / rejected)

- Lapse handling: revoking pending invites, downgrade state machine —
  Step 7 (the accept-time guard here is its belt).
- Member-removal transfer-to-self/other/delete choice — Step 7.
- Existing Teams-subscription migration to the single plan, `newSeats`
  contract removal, `viewer_seats` column-level cleanup — Step 8.
- Live proration preview in the invite form — rejected (static copy).
- In-app seat-change notification — rejected (email only).
- Visible viewer-seat math or viewer billing UI — rejected (parent §8).

## 11. Implementation notes (2026-09-04)

Shipped as designed, with these divergences:

- **No separate `sendSeatChangeEmail` service file** — the send lives inside
  `syncSeatQuantity` (it already holds the live Stripe item price and the
  recomputed count the email needs); only the template is its own file
  (`emails/seatChangeEmail.ts`). `DomainLogFields`' `email.template` union
  gained `'seat-change'`.
- **Accept-route atomicity via data-modifying CTEs, not a transaction** —
  the Db port has no transaction surface and pool `query()` calls can hop
  connections (BEGIN/COMMIT across them is unsafe), so the three writes
  (member upsert, invitation accepted, default-workspace switch) became ONE
  statement with CTEs. Same effect, no port change.
- **"Interval switch UI stays" was wrong** — the BillingPage never had an
  interval switch for ACTIVE subscriptions (the monthly/yearly toggle only
  exists on the checkout card); the removed seat stepper was
  `/subscription-change`'s only webapp caller. The route is now API-only
  (interval changes with computed quantity + tolerated `newSeats`) until
  some future interval UI; `StripeService.subscriptionChange` remains for
  that day.
- **Viewer-ceiling count excludes the re-invited email itself** — the invite
  route deletes + reinserts the invitation row, so a re-invite of an
  already-pending viewer at the ceiling must not self-block.
- **Webapp extras**: `billing/prices.ts` now owns `PRICE_MONTHLY`/
  `PRICE_YEARLY` (deduped from BillingSection, shared with the invite-form
  delta copy); the Members seat summary shows billed seats × price +
  viewer count + pending-invite hint in one card (both SeatPanels and the
  `VIEWER_SEATS_PER_CREATOR` constant deleted); `BillingSection` lost its
  `seatFloor` prop (floor logic gone) but kept `onGoToMembers` for the
  "Manage members" link in the read-only seats row.
- **Checkout tests gained an e2e tier** — the route now reads the DB
  (authz + computed quantity), so its happy path moved out of the no-db
  validation tier.
- The pre-existing subscriptionChange test pins for the seat floor were
  replaced by computed-quantity pins (incl. a stale-owner-row pin on the
  compute path).

Deploy checklist (not yet done): server → webapp, back-to-back; no
migration, no env changes. Old webapp against new server degrades safely
(stepper calls ignored with a warn; gating errors surface as toasts).
