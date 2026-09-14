# Seat pre-purchase — buy creator seats before inviting (oneshot)

**Status:** Implemented 2026-09-14. Server suite green (real Postgres tier),
server + webapp typecheck and dev build, Playwright billing specs green
against the local stack with Stripe test mode (including the real hosted
Checkout page). Deploy: server → webapp, back to back; no migration, no
env changes.

## 1. Context

The billing revamp's Step 6 (2026-09-04) made seats *derived state*: the
owner upgraded with quantity 1 and every accepted creator/admin invite bumped
the Stripe quantity; removals shrank it; the manual seat stepper was deleted.
That is reversed here: **seats are purchased capacity, bought in advance**.
Creator/admin invitations need a free purchased seat, and the bill only changes
when an admin explicitly buys or drops seats (billing-page stepper, or the
quantity chosen at checkout). The earlier `plans/` docs were removed at the
same time (user decision — old and irrelevant); this file is the single
reference. Code comments that still cite the deleted docs are historical
pointers only.

## 2. Decisions (confirmed 2026-09-14)

| Question | Decision |
|---|---|
| Do pending creator/admin invitations reserve a seat? | **Yes.** An invite is refused once `used + pending` reaches `purchased`. Accept re-checks `used < purchased` as a belt (race / seats reduced meanwhile). |
| What happens to a seat when a creator/admin is removed or downgraded to viewer? | **It stays purchased** — free capacity for the next invite. The bill drops only when an admin lowers the count on the billing page. No automatic Stripe change anywhere → the Step 6 seat-change email and the webhook drift detector are deleted. |
| Seat reduction mid-period | **Immediate, with a balance credit** (`proration_behavior: 'always_invoice'` in both directions): an increase invoices the prorated remainder now; a decrease credits the unused remainder to the Stripe customer balance — never cash, never expires, offsets the next invoice. Considered and rejected: reduce at period end via Subscription Schedules (more machinery), expiring credits (not native to Stripe; strictly worse for the customer than keeping the seat). |
| Seat floor when reducing | `used + pending` — remove members / cancel invitations first. |
| Checkout quantity | Chosen by the admin (`seats`), default and minimum = seats in use — a lapsed workspace re-upgrading keeps its members covered. |
| Upgrade e2e test | Drives the **real hosted Stripe Checkout** (test card); the fixture delivers the signed `checkout.session.completed` webhook itself, so `stripe listen` is not needed. |

## 3. Seat model

| Term | Definition | Source |
|---|---|---|
| `purchased` | seats bought | `subscriptions.seats` — mirrors the Stripe quantity; written only by the checkout webhook, `/subscription-change`, and the subscription webhooks |
| `used` | 1 (owner, no member row) + creator/admin member rows (stale owner rows excluded) | `getSeatUsage` |
| `pending` | pending creator/admin invitations | `getSeatUsage` |
| `available` | `max(0, purchased − used − pending)` | `seatsAvailable` |

Viewers are unchanged: free, hidden `VIEWER_CEILING` (50). The entitlements
payload is unchanged (`canInvite` = pro); seat capacity is a per-role check in
the routes.

## 4. Server

- `services/seatBilling.ts` — `getSeatUsage(db, workspaceId, { excludeInviteEmail? })`
  and `seatsAvailable(usage)` replace `computeBilledSeats` + `syncSeatQuantity`.
  The excluded email keeps a re-invite from blocking on its own reservation.
  Error strings live here (`NO_SEATS_AVAILABLE_ERROR`, `ACCEPT_NO_SEATS_ERROR`).
- `/workspace-invite` — creator/admin: 403 `NO_SEATS_AVAILABLE_ERROR` when
  `available === 0`. Viewer path unchanged (ceiling).
- `/workspace-invite-accept` — creator/admin: 200 `{ error: ACCEPT_NO_SEATS_ERROR }`
  when `used >= purchased`, unless the caller already holds a seat (creator
  re-invited as admin). No Stripe, no email.
- `/workspace-member-remove` — pure membership removal; no billing.
- `/workspace-member-update-role` — viewer → creator/admin needs pro AND a free
  seat (same message as invite); no sync.
- `/stripe-checkout` — body `seats?` (default `used`); `seats < used` → 400;
  `quantity: seats`.
- `/subscription-change` — `newSeats` honored: target `newSeats ?? current`;
  floor `used + pending` → 400 "Cannot reduce below N seats — N are in use or
  reserved by pending invitations"; no-op guard kept; dryRun preview and apply
  at the target quantity (`always_invoice`).
- `/stripe-webhooks` — drift detector removed; seats still mirror the item quantity.
- Deleted: `emails/seatChangeEmail.ts` (+ its preview entries, the
  `'seat-change'` log template).

## 5. Webapp

- `BillingSection` — checkout card gets a seat stepper (min = seats in use);
  the active-plan row gets the stepper back with a 500 ms-debounced dry-run
  preview ("Charged today $A" / "Credited to your balance $A", next renewal)
  and **Update seats**; server 400s surface as toasts with the server message.
  Accessible handles: `Add seat` / `Remove seat` buttons, `Seats` output,
  `Update seats`, `Upgrade to Pro`.
- `MembersSection` — seat card "N of M seats used", "R reserved by pending
  invites", "Add seats →" / "Manage seats →" for admins; the Creator option is
  disabled at capacity (selection falls back to Viewer) with "No creator seats
  available — add seats to invite more creators."; sent/resent invitations
  update the page immediately (`onInvitationSent`) so the reservation shows.
- `WorkspaceSettingsPage` derives `usedSeats` / `seatFloor` from the details
  blob and passes `onSeatsChanged` so the Members card follows seat changes.
- `StripeService.createCheckoutSession(…, seats)`; `api/client.ts` gains
  `apiErrorMessage(error, fallback)` (reads the server's `{ error }` body).

## 6. Tests

- Server (vitest, real Postgres): `seatBilling.test.ts` (usage matrix, pending
  reservation, exclusion, clamp), invite / accept / remove / update-role
  capacity pins, checkout `seats`, subscription-change floor + newSeats +
  interval-only, webhook drift test removed.
- Playwright `e2e/tests/billing.spec.ts` (its own `billing` project and a
  dedicated account `BILLING_USER`, signed in by `billing.setup.ts`, so the
  main e2e user's workspace is never touched; serial; the account's workspace
  is reset before/after each test):
  1. **owner upgrades to Pro through Stripe Checkout** — real hosted page,
     test card, signed webhook delivered by the fixture, "Subscription
     activated", "Pro · 1 seat" survives a reload.
  2. **admin buys seats, then invites creators up to the limit** — seeded
     test-mode subscription (1 seat) → stepper to 3 → preview → Update seats →
     "1 of 3 seats used" → two creator invites → "2 reserved", "No creator
     seats available", picker falls back to Viewer → viewer invite still works.
- `e2e/fixtures/billing.ts`: Stripe test-mode REST helper, signed-webhook
  delivery, `seedProSubscription`, `resetBilling` (Stripe customer deleted,
  invites rescinded, members removed via the app API, subscription row deleted
  through PostgREST with the service role). The Playwright config accepts
  `E2E_WEBAPP_PORT` / `E2E_API_URL` to target a second stack.

## 7. Verification log (2026-09-14)

- `npx vitest run server/test/services server/test/workspaces server/test/billing` — 171 passed.
- `cd server && npm run typecheck` — clean; `npm run build:webapp:dev` — clean.
- `E2E_WEBAPP_PORT=3003 E2E_API_URL=http://localhost:8081 npx playwright test`
  — full suite: 17 passed, 1 failed (second server instance running the new
  code; the long-running dev server on 8080 was left untouched). The failure,
  `editor.spec.ts › share modal opens with the owner controls`, is
  pre-existing seed state: user1's "My Workspace" has no subscription and its
  trial expired 2026-06-24, so Share opens the upgrade dialog. Unrelated to
  this change (the billing specs run on their own account).
- `npx vitest run server/test server/src webapp/src` — 652 passed, 1 failed:
  `webapp/src/storage/cloudProjectService.test.ts` (saveProjectMetadata arity)
  — reproduces at HEAD in a clean worktree; pre-existing.
- Teardown verified: no subscription row / invitations / members left on the
  billing user's workspace; no stray Stripe test customers.

## 8. Follow-ups / notes

- `npm run dev:server` does not watch files — restart it to pick up the
  server changes before using the billing page locally.
- Code comments across the repo still cite deleted `plans/…` docs (historical
  pointers); the `ui-guidelines` skill cites `plans/testable-ui-labels.md`.
- Lapse handling (revoking pending invites on cancellation) and the member
  removal transfer/delete choice remain unimplemented, as before.
- Seat reduction below `used + pending` is refused; over-capacity after a
  webhook-driven quantity drop (e.g. a change made in the Stripe dashboard) is
  grandfathered: existing members keep access, new creator invites are blocked.
