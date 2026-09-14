# Seat pre-purchase: buy creator seats before inviting (+ billing e2e tests)

## Context

Billing revamp Step 6 (shipped 2026-09-04) made seats *derived state*: the owner
upgrades with quantity 1 and every accepted creator/admin invite bumps the Stripe
quantity (`server/src/services/seatBilling.ts` → `syncSeatQuantity`), removals shrink
it, and the manual seat stepper was deleted. The owner wants the opposite model:
**seats are purchased capacity, bought in advance**. Creator/admin invitations need a
free purchased seat; the bill changes only when an admin explicitly buys or drops seats
(billing-page stepper, or the quantity chosen at checkout).

Also requested: two Playwright e2e tests — (1) a user upgrades to Pro, (2) a user adds
seats and invites people.

Decisions confirmed with the user (2026-09-14):
- Pending creator/admin invitations **reserve** a seat.
- Removing/downgrading a member **keeps the seat purchased** (no automatic Stripe
  changes anywhere → seat-change email + webhook drift detector are deleted).
- The upgrade e2e test **drives the real hosted Stripe Checkout** (test card).
- Docs: **delete everything under `plans/`** (old, irrelevant) and write one oneshot
  doc `plans/seat-prepurchase-oneshot.md`.
- **Seat reductions are immediate with a balance credit** (kept from Step 6):
  `/subscription-change` keeps `proration_behavior: 'always_invoice'` in both
  directions — increases invoice the prorated remainder now, decreases credit the
  unused remainder to the Stripe customer balance (never cash, never expires; offsets
  the next invoice). No subscription schedules, no custom credit bookkeeping. The
  stepper copy states this: reducing → "Unused time for removed seats is credited to
  your next invoice."; the dryRun preview shows `immediateCharge` (negative → shown as
  "Credit $X to your balance").

## Seat model

| Term | Definition | Source |
|---|---|---|
| `purchased` | seats bought | `subscriptions.seats` — mirrors Stripe quantity; written only by the checkout webhook, `/subscription-change`, subscription webhooks |
| `used` | 1 (owner) + creator/admin member rows (stale owner rows excluded) | the existing `computeBilledSeats` SQL |
| `pending` | pending creator/admin invitations | `workspace_invitations` |
| `available` | `purchased − used − pending` (≥ 0) | computed |

- Creator/admin **invite** and viewer→creator/admin **promotion** require
  `available > 0`. Re-inviting an already-pending email excludes itself from `pending`
  (same trick the viewer ceiling uses).
- **Accept** re-checks `used < purchased` as a belt (race / seats reduced meanwhile).
- **Remove / downgrade** frees capacity; never touches Stripe.
- **Reduce seats** (`/subscription-change`): floor is `used + pending`.
- **Checkout** takes a `seats` quantity; default and minimum = `used` (a lapsed
  workspace re-upgrading keeps its members covered).
- Viewers unchanged: free, hidden `VIEWER_CEILING`. Entitlements payload unchanged
  (`canInvite` = pro); seat capacity is a per-role check in the routes.

## Server changes

**`server/src/services/seatBilling.ts`** — replace `computeBilledSeats` +
`syncSeatQuantity` with:
```ts
export interface SeatUsage { purchased: number | null; used: number; pending: number }
export async function getSeatUsage(db, workspaceId, opts?: { excludeInviteEmail?: string }): Promise<SeatUsage>
export function seatsAvailable(u: SeatUsage): number  // max(0, purchased - used - pending); 0 when purchased is null
```
Keep `VIEWER_CEILING`. Delete `server/src/emails/seatChangeEmail.ts`, its four
entries in `server/scripts/previewEmails.ts`, and `'seat-change'` from the
`email.template` union in `server/src/logging.ts`.

**Routes** (`server/src/routes/…`; update each file's doc-comment reference to the
new plan doc):
- `workspaces/workspaceInvite.ts` — after the `canInvite` gate, for `creator|admin`:
  `seatsAvailable(await getSeatUsage(db, ws, { excludeInviteEmail: email })) === 0`
  → 403 `{ error: 'No creator seats available — add seats on the billing page' }`.
- `workspaces/workspaceInviteAccept.ts` — remove the `syncSeatQuantity` call and the
  profile-name lookup; for `creator|admin`, before the CTE write: `used >= purchased`
  → 200 `{ error: 'This workspace has no available seats. Ask a workspace admin to add seats.' }`.
  Keep the lapse guard and the single CTE statement.
- `workspaces/workspaceMemberRemove.ts` — drop the pre-delete role/email lookup and
  the sync; pure membership removal (transfer → strip editors → delete).
- `workspaces/workspaceMemberUpdateRole.ts` — viewer→seat promotion keeps the
  `canInvite` 403 and adds the capacity 403 (same message as invite); drop the sync.
- `billing/stripeCheckout.ts` — body gains `seats: Optional(Integer({ minimum: 1 }))`;
  `used = getSeatUsage(...).used`; default `seats = used`; `seats < used` → 400
  `{ error: 'Checkout needs at least N seats for the current members' }` (add the 400
  response schema); `quantity: seats`.
- `billing/subscriptionChange.ts` — `newSeats` honored again (delete the deprecation
  warn and comment): `targetSeats = newSeats ?? sub.seats`; floor
  `targetSeats < used + pending` → 400
  `{ error: 'Cannot reduce below N seats — N are in use or reserved by pending invitations' }`;
  keep the no-op guard (`'No change in seats or billing interval'`), the yearly→monthly
  block; dryRun preview uses `quantity: targetSeats`; apply → `updateSubscription`
  (always_invoice) + DB `seats = targetSeats, billing_interval = targetInterval`;
  response `seats: targetSeats`.
- `billing/stripeWebhooks.ts` — delete the drift-detector block and the import.

**Shared contract**: comment-only updates (`shared/api/workspaces.ts` `seats` =
purchased seats; `shared/api/entitlements.ts` canInvite note). No new endpoints.

## Webapp changes (ui-guidelines: `Button`, `Dropdown`, semantic tokens, accessible labels)

- **`webapp/src/pages/settings/WorkspaceSettingsPage.tsx`** — derive from `details`:
  `usedSeats = 1 + creator/admin members`, `reservedSeats = pending creator/admin
  invitations`; pass `seatFloor = usedSeats + reservedSeats` and `usedSeats` to
  `BillingSection`, plus `onSeatsChanged(seats)` → `setDetails(prev => ({ ...prev, seats }))`
  so the Members card updates without a reload.
- **`webapp/src/pages/settings/BillingSection.tsx`**
  - Active plan: replace the read-only seats row with a stepper — icon-only `Button`s
    `aria-label="Remove seat"` / `"Add seat"`, the count element `aria-label="Seats"`,
    `N seats × $X = $Y/mo`; when the draft differs from `subscription.seats`, a 500 ms
    debounced `StripeService.subscriptionChange({ dryRun: true })` preview line
    ("Charged today $A · next renewal $B on <date>") and an "Update seats" `Button`
    (apply → toast "Seats updated" → `AuthManager.refreshSubscription()` →
    `onSeatsChanged`). "Remove seat" disabled at `seatFloor`. Server 400s → error toast
    with the server message.
  - Checkout card: the same stepper (min/default = `usedSeats`), price line
    `N seats × $X / month · billed …`; passes `seats` to
    `StripeService.createCheckoutSession`.
  - Delete all "Seats adjust automatically…" copy.
- **`webapp/src/pages/settings/MembersSection.tsx`**
  - Seat card: `used of purchased seats used` (+ `R reserved by pending invites` when
    any); admins with `available === 0` see an "Add seats →" link (`onGoToBilling`).
  - Invite form: `Dropdown` creator option `disabled` when `available === 0` (selection
    falls back to viewer); helper text: no seats → "No creator seats available — add
    seats to invite more creators."; creator → "Uses 1 of your N purchased seats.";
    viewer → "Viewers are free." Server 403s keep surfacing as toasts.
- **`webapp/src/billing/StripeService.ts`** — `createCheckoutSession(userId, email,
  interval, workspaceId, seats)` forwards `seats`; `subscriptionChange` unchanged.

## Server tests to rewrite (vitest, real Postgres via the root config)

- `server/test/services/seatBilling.test.ts` → `getSeatUsage` matrix: owner only;
  +creator/+admin; viewers free; stale owner row ignored; pending creator invites
  counted, pending viewer invites not; `excludeInviteEmail`; `purchased` null without a
  row; `seatsAvailable` clamps at 0.
- `server/test/workspaces/workspaceInvite.test.ts` — purchased 3: two creator invites
  OK, third 403 (message pinned); pending invites reserve; re-inviting the pending email
  doesn't self-block; viewer invites unaffected by capacity.
- `…/workspaceInviteAccept.test.ts` — creator accept: no Stripe calls, no email; full
  workspace → business error, no member row; re-invite viewer→admin needs a free seat.
- `…/workspaceMemberRemove.test.ts` — removing a creator never touches Stripe; seats
  unchanged.
- `…/workspaceMemberUpdateRole.test.ts` — promotion at capacity → 403; with room →
  200 and no Stripe; downgrade → no Stripe, seats unchanged.
- `server/test/billing/stripeCheckout.test.ts` — `seats` forwarded; default = used
  (solo owner 1, +creator 2); below used → 400.
- `server/test/billing/subscriptionChange.test.ts` — `newSeats` honored (dryRun
  quantity = newSeats; apply writes it); floor 400 (members + pending); no-op guard;
  interval-only keeps current seats; drop the deprecated-warn assertion.
- `server/test/billing/stripeWebhooks.test.ts` — delete the DRIFT DETECTOR test.

## E2E tests (Playwright)

Both tests mutate the e2e user's default workspace subscription → one file
`e2e/tests/billing.spec.ts` with `test.describe.configure({ mode: 'serial' })`;
`test.setTimeout(120_000)` for the hosted-checkout test.

**`e2e/fixtures/project.ts`** — export the existing `signIn` and `api` helpers.

**`e2e/fixtures/billing.ts`** (Node side):
- `loadStripeEnv()` — dotenv-parse `server/.env.local` for `STRIPE_SECRET_KEY`,
  `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID_MONTHLY` (the values the running server
  uses, so signatures/prices line up); missing → `test.skip` with a clear message.
- `stripe(method, path, form?)` — form-encoded fetch to `https://api.stripe.com/v1`.
- `postSignedWebhook(type, object)` — `t=<now>,v1=HMAC-SHA256(secret, "<t>.<body>")`
  → `POST ${API_URL}/stripe-webhooks`; the real handler runs. (A concurrent
  `stripe listen` delivery is harmless: the checkout handler is an upsert.)
- `seedProSubscription(workspaceId, userId, seats)` — Stripe: customer with
  `pm_card_visa` as default payment method → subscription (monthly price, quantity)
  → `postSignedWebhook('checkout.session.completed', { metadata: { userId, workspaceId },
  customer, subscription })`.
- `resetBilling(workspaceId)` — `subscription-get` → if `stripe_customer_id`,
  `DELETE /v1/customers/{id}` (cancels its subscriptions); rescind pending invites and
  remove non-owner members through the app API (`workspace-get` →
  `workspace-invite-rescind` / `workspace-member-remove`); delete the `subscriptions`
  row via Supabase PostgREST with the service-role key (`DELETE /rest/v1/subscriptions?workspace_id=eq.…`)
  — the one step no app route can do; same service-role pattern `fixtures/project.ts`
  uses for storage.
- `currentWorkspace()` — `workspace-get-default` (what the app itself loads).

**Test 1 — "owner upgrades to Pro through Stripe Checkout"**: `resetBilling` →
`/workspace/settings/billing` shows "Upgrade to Pro" (seats 1) → click →
`page.waitForEvent('popup')`, URL `checkout.stripe.com` → fill the hosted page
(`#cardNumber` 4242 4242 4242 4242, `#cardExpiry`, `#cardCvc`, `#billingName`,
country/postal if shown; leave Link "save info" unchecked; submit) → parse `cs_test_…`
from the popup URL, poll `GET /v1/checkout/sessions/{id}` until `status === 'complete'`
→ `postSignedWebhook('checkout.session.completed', session)` → assert "Subscription
activated" and "Pro · 1 seat"; reload → still Pro. Teardown `resetBilling`.
Selectors are verified against the live test-mode page during implementation.

**Test 2 — "admin buys seats, then invites up to the limit"**: `resetBilling` +
`seedProSubscription(seats 1)` → billing shows 1 seat → "Add seat" ×2 → preview line
visible → "Update seats" → "3 seats" (reload persists) → Members card "1 of 3 seats
used" → invite `e2e-a@example.com` and `e2e-b@example.com` as creator (both pending;
card shows 2 reserved) → creator option disabled + "No creator seats available" text
→ inviting `e2e-v@example.com` as viewer still succeeds. Teardown `resetBilling`.

**`e2e/README.md`** — replace the "Subscribe to a plan (Stripe)" outline with the real
prerequisites (Stripe test keys in `server/.env.local`, no `stripe listen` needed);
drop the reference to the deleted `plans/testable-ui-labels.md`.

## Docs

- `git rm -r plans/*` (all existing plan files/folders — user decision; recoverable
  from git). Known consequence: ~60 code comments still cite deleted plan paths
  (mostly `plans/user-default-project-settings`, admin impersonation, billing revamp);
  only the files touched here get their references repointed. The `ui-guidelines`
  skill also cites `plans/testable-ui-labels.md` — flag at the end and ask before
  editing the skill (CLAUDE.md rule).
- New `plans/seat-prepurchase-oneshot.md`: context, seat model, decisions above,
  server/webapp/e2e implementation notes, verification log.

## Verification

1. `npx vitest run server/test/services server/test/workspaces server/test/billing`
   from the repo root (loads `.env.test` → real Postgres) — all green.
2. `cd server && npm run typecheck`; `npm run build:webapp:dev`; `npm run lint`.
3. Stack is already up (Supabase, server :8080, webapp :3001; Stripe test keys present):
   `npx playwright test --config e2e/playwright.config.ts billing` — both tests green,
   then the full `npm run test:e2e`.
4. Browser smoke: stepper preview/apply on the billing page, Members seat card, creator
   option disabled at capacity.
