# Affiliate / creator referral program — oneshot plan

> Status: **designed, not started.** Nothing in this plan has been implemented.

## Context

We want to start reaching out to YouTubers. Today there is no way to tell a creator "send people
here and you get paid" — the codebase has **zero** referral, coupon, discount, promo-code, or
signup-attribution machinery (verified: `grep -rE 'coupon|discount|promo|referral|utm_|attribution'`
across `webapp/`, `server/`, `shared/`, `extension/` returns only unrelated hits). Inbound UTM
params already land on the webapp and are dropped on the floor.

This plan adds the minimum that lets us onboard a handful of hand-picked creators, attribute the
signups they drive, discount those signups, accrue a recurring revenue share, and know what we owe
each creator each month. Payouts happen by hand, outside the system.

**Intended outcome:** a creator gets `https://app.recordio.io/r/johndoe`, their audience gets 25% off
their first three months, and we can open an admin page and see exactly what to PayPal that creator
this month.

### Decisions already made (do not re-open during implementation)

| | |
|---|---|
| Commission | **25% of every payment, for 12 months from conversion** |
| Audience discount | **25% off the first 3 months** (see "Yearly discount" below — yearly needs a different coupon for the same cost) |
| Attribution | Referral **link + first-party cookie**, 60-day window, with a **manual code** fallback at checkout |
| Payouts | **Manual, admin-reviewed.** No Stripe Connect, no payout rails in code |
| Onboarding | **Invite-only.** Admin creates each affiliate; there is no public application form |
| Creator UI | **Read-only stats page.** No self-serve dashboard, no payout UI, no code editing |
| Clearing | Commission is not payable until **30 days** after the invoice was paid |

### Scope explicitly deferred

Self-serve affiliate signup, per-affiliate commission tiers, creator-editable payout details,
Stripe Connect / automated payouts, chargeback→invoice resolution, extension-side attribution, a
public `/affiliates` marketing page, multi-currency FX. The schema is shaped so none of these need a
migration rewrite.

---

## Referral links land on the app, not the marketing site

**Creator links are `https://app.recordio.io/r/<code>`.** The marketing site is not involved and
`../recordio-landing` is **not touched by this plan at all**.

This is a large simplification over routing through `recordio.io`, and it also converts attribution
from "best effort across a multi-hop funnel" into something close to bulletproof:

- **The cookie is set and read on the same origin, seconds apart.** No cross-subdomain sharing, no
  Chrome-Web-Store detour in the critical path, no window in which the cookie can be evicted before
  anyone reads it.
- **No server-side hop at all.** The link is handled by the webapp's own JS on page load — no
  Cloudflare Pages Function, no `_routes.json`, no second deploy, no shared secrets, no Astro
  `trailingSlash` / `astro dev` problems. See "Why no Pages Function" below.
- **The logged-out app root is already a designed, branded landing surface** —
  [`AuthPage.tsx`](webapp/src/auth/AuthPage.tsx) + [`SignInForm.tsx`](webapp/src/auth/SignInForm.tsx).
  A viewer arriving from a video sees branding and a "Continue with Google" button, which is the
  action we actually want, and we can show the referral offer right on it (see below).
- **Signup now happens on the first page load after the click**, not after an extension install. The
  cookie only has to survive the Google OAuth round-trip, which is same-site.

⚠️ **This changes the funnel, and that's a product decision worth being deliberate about.** Today
the marketing site pushes people to the Chrome Web Store first; a referral link now pushes them to
sign up first and install the extension afterwards, from inside the app. Confirm that post-signup
install prompt exists and is good before sending a creator's audience through it.

The API server is still the exception: `recordio-production.up.railway.app` is a different
registrable domain, and [`webapp/src/api/client.ts`](webapp/src/api/client.ts) sends a bearer token
with **no** `credentials`. CORS there is `origin: '*'`, which can't be combined with credentials
anyway. So:

- The cookie **cannot be `HttpOnly`** — the webapp's JS must read it and put the code in a JSON body.
  That's fine; this is a marketing string, not a credential, and it's already user-supplied via the
  manual-code path.
- **The cookie's contents are never trusted for anything security-relevant.** It carries only the
  code and a `visitorId`. The authoritative click time comes from the server-recorded
  `affiliate_clicks` row, not from the cookie — see "The click row is the trust anchor" below.

**Local dev:** `http://localhost:3001/r/CODE` or `?ref=CODE` works directly against `vite dev` —
nothing else needs to run but the webapp and the API. Cookies ignore port, so a `Domain`-less,
`Secure`-less cookie on `localhost` behaves identically to production.

### Why no Pages Function

An earlier draft put a Cloudflare Pages Function at `/r/*` to set a server `Set-Cookie`, HMAC-sign
it, and record the click edge-side. Landing on `app.recordio.io` removes almost all of its value, so
it is **not** in this plan:

| Claimed benefit | Verdict |
|---|---|
| Server `Set-Cookie` dodges Safari's 7-day cap on JS-written cookies | **Nearly moot.** The cookie is read seconds later in the same session, and Recordio is a Chrome extension — Safari users can't install it |
| HMAC makes `issuedAt` unforgeable | **Doesn't hold up.** The only attack is forging an *older* `issuedAt` so an existing account passes the age guard — and the prize is a discount already obtainable by typing the code, since the manual path accepts any never-paid account regardless of age |
| Redirect strips `?ref=` from the URL | **No advantage.** `history.replaceState` already does this in JS |
| Server-side click recording (IP, referer, country) | **The only real one** — and click counts are the creator's vanity numerator, not something payouts depend on. The API still sees the real IP on the beacon; `document.referrer` still travels; only edge-provided `country` is lost |

Net: it costs a Function, two shared secrets, HMAC sign/verify code on both sides, and a
`wrangler pages dev` story, to buy a geo column.

### The click row is the trust anchor

Instead of signing a timestamp into the cookie, **use the server-recorded click**. The cookie carries
`code` + `visitorId`; the client posts `referral-click`; `referral-claim` then looks up that
`affiliate_clicks` row and uses its own `occurred_at` as the authoritative click time. Server-written,
unforgeable, and it's data the schema already stores for the creator's dashboard.

**If no click row exists** — the beacon was blocked, or the visitor arrived with a cookie from a
cleared-analytics session — attribution falls back to the **manual path's rules**: never-paid only,
no age check. That is a graceful degradation into looseness this plan already accepts deliberately,
and it means an ad-blocked click costs a creator nothing.

---

## Data model

One migration, `supabase/migrations/<date -u '+%Y%m%d%H%M%S'>_affiliate_program.sql`. Get the
timestamp by actually running that command (`supabase/migrations/CLAUDE.md` hard rule). Create in
FK order: `affiliates` → `affiliate_clicks` → `referral_attributions` → `referral_conversions` →
`affiliate_payouts` → `referral_commissions`.

Every table gets `ENABLE ROW LEVEL SECURITY` with **no policies**, matching current practice since
`20260513194112_drop_all_rls_policies.sql` — all access is server-mediated. Regenerate the per-table
docs with `supabase/sql/dump-tables.sh` afterwards.

There is deliberately **no `affiliate_programs` config table**. Rates live as constants in
`server/src/services/referralProgram.ts` and are *snapshotted onto each conversion row*, so changing
the rate later never rewrites live deals.

### `affiliates`

```sql
id uuid PK
user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE
code text NOT NULL UNIQUE CHECK (code = lower(code) AND code ~ '^[a-z0-9][a-z0-9_-]{2,31}$')
status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended'))
display_name text
payout_method text CHECK (payout_method IN ('paypal','wise','other'))
payout_email text
payout_details text
note text                       -- admin's private note: which channel, deal terms, etc.
created_at, updated_at timestamptz NOT NULL DEFAULT now()
```

`user_id` is required and unique: a creator signs in with the same Google auth as any user, and
their `/affiliate` page is just their own row. Admin creates the row against an existing user id
(found via the existing `admin-user-list` fuzzy picker).

Keep a reserved-code blocklist (`admin`, `app`, `api`, `login`, `pricing`, `blog`, `help`,
`support`, `recordio`) in `server/src/services/referralProgram.ts`, not in the DB.

### `affiliate_clicks`

```sql
id bigserial PK
affiliate_id uuid NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE
visitor_id uuid NOT NULL                       -- client-generated, cookie-persisted
occurred_at timestamptz NOT NULL DEFAULT now()
click_day date GENERATED ALWAYS AS ((occurred_at AT TIME ZONE 'UTC')::date) STORED
landing_path, referrer_host, utm_source, utm_medium, utm_campaign text
ip_hash text                                   -- sha256(ip + salt); NEVER the raw IP
user_agent text

UNIQUE (affiliate_id, visitor_id, click_day)   -- ← a "click" means unique visitor per UTC day
INDEX (affiliate_id, click_day DESC)
```

The unique index is the whole design: insert is `ON CONFLICT DO NOTHING`, so refresh-spam and stable
bots can neither inflate the creator's dashboard nor grow the table unboundedly.

### `referral_attributions` — one row per referred **user**

```sql
referred_user_id uuid PK REFERENCES auth.users(id) ON DELETE CASCADE
affiliate_id uuid NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE
code_used text NOT NULL
source text NOT NULL CHECK (source IN ('link','manual','admin'))
click_id bigint REFERENCES affiliate_clicks(id) ON DELETE SET NULL
attributed_at timestamptz NOT NULL DEFAULT now()
expires_at timestamptz NOT NULL CHECK (expires_at > attributed_at)   -- +60 days
locked_at timestamptz                                                -- set at first conversion
INDEX (affiliate_id, attributed_at DESC)
```

**PK on the user** means a user can never be attributed to two creators at once, so there is no
"who gets paid" tie-break at conversion time. The claim is an upsert with
`DO UPDATE ... WHERE referral_attributions.locked_at IS NULL` — last touch wins until the first
conversion, then it's frozen forever.

### `referral_conversions` — one row per **workspace**

```sql
id uuid PK
affiliate_id uuid NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE
referred_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
workspace_id uuid NOT NULL UNIQUE REFERENCES workspaces(id) ON DELETE CASCADE
code_used text NOT NULL
commission_rate_bps int NOT NULL CHECK (BETWEEN 0 AND 10000)   -- snapshot: 2500
commission_window_months int NOT NULL CHECK (> 0)              -- snapshot: 12
clearing_days int NOT NULL CHECK (>= 0)                        -- snapshot: 30
converted_at timestamptz NOT NULL
commission_ends_at timestamptz NOT NULL CHECK (> converted_at)
status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','void'))
void_reason text
INDEX (affiliate_id, converted_at DESC), INDEX (referred_user_id)
```

`UNIQUE (workspace_id)` makes conversion creation a safely retryable
`INSERT ... ON CONFLICT (workspace_id) DO NOTHING`, and guarantees the webhook's
customer → workspace → conversion lookup returns at most one affiliate.

### `affiliate_payouts`

```sql
id uuid PK
affiliate_id uuid NOT NULL REFERENCES affiliates(id) ON DELETE RESTRICT
currency text NOT NULL CHECK (currency = lower(currency) AND char_length(currency) = 3)
amount_cents int NOT NULL CHECK (amount_cents > 0)
status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','canceled'))
method text NOT NULL CHECK (method IN ('paypal','wise','other'))
destination, reference, note text
created_by uuid NOT NULL REFERENCES auth.users(id)
marked_paid_by uuid REFERENCES auth.users(id)
created_at, updated_at timestamptz NOT NULL DEFAULT now()
paid_at, canceled_at timestamptz
CHECK (status <> 'paid' OR paid_at IS NOT NULL)

UNIQUE (affiliate_id, currency) WHERE status = 'pending'   -- ← anti-double-pay
INDEX (affiliate_id, created_at DESC)
```

`ON DELETE RESTRICT` on `affiliate_id`: paid money is a financial record; deleting a creator must
fail loudly rather than vaporize the audit trail.

### `referral_commissions` — append-only ledger

```sql
id uuid PK
affiliate_id uuid NOT NULL REFERENCES affiliates(id) ON DELETE RESTRICT
conversion_id uuid REFERENCES referral_conversions(id) ON DELETE RESTRICT
workspace_id uuid REFERENCES workspaces(id) ON DELETE SET NULL
kind text NOT NULL CHECK (kind IN ('accrual','reversal','adjustment'))
status text NOT NULL CHECK (status IN ('open','paid','void'))
amount_cents int NOT NULL                       -- SIGNED: reversals are negative
currency text NOT NULL CHECK (currency = lower(currency) AND char_length(currency) = 3)
basis_cents int NOT NULL CHECK (>= 0)
commission_rate_bps int NOT NULL
source_type text CHECK (source_type IN ('invoice','credit_note','manual'))
source_id text                                  -- stripe invoice / credit note id
stripe_invoice_id text
stripe_event_type text
reverses_commission_id uuid REFERENCES referral_commissions(id) ON DELETE RESTRICT
occurred_at timestamptz NOT NULL                -- when the invoice was PAID
clears_at timestamptz NOT NULL                  -- occurred_at + clearing_days
payout_id uuid REFERENCES affiliate_payouts(id) ON DELETE SET NULL
note text
created_at, updated_at timestamptz NOT NULL DEFAULT now()

CHECK (kind <> 'accrual'  OR (amount_cents >= 0 AND source_id IS NOT NULL AND conversion_id IS NOT NULL))
CHECK (kind <> 'reversal' OR (amount_cents <= 0 AND source_id IS NOT NULL AND reverses_commission_id IS NOT NULL))
CHECK (payout_id IS NULL OR status IN ('open','paid'))

UNIQUE (kind, source_type, source_id) WHERE source_id IS NOT NULL   -- ← THE idempotency constraint
INDEX (affiliate_id, currency, status)
INDEX (stripe_invoice_id) WHERE stripe_invoice_id IS NOT NULL
INDEX (conversion_id)
INDEX (payout_id) WHERE payout_id IS NOT NULL
```

Two shape decisions worth defending:

- **Append-only with signed amounts.** A refund never mutates the accrual — it inserts a negative
  `reversal` row. Balances are `SUM(amount_cents)`. The ledger reconciles against Stripe line by
  line, and a *partial* refund has an obvious representation.
- **Only three statuses (`open`/`paid`/`void`), no `pending`→`payable` state machine and no
  clearing job.** The 30-day hold is a `WHERE clears_at <= now()` predicate at payout time, not a
  stored state. One fewer moving part, and it can't drift.

### Idempotency, in one place

There is no processed-events ledger in this codebase (deliberate, documented in the
[`stripeWebhooks.ts`](server/src/routes/billing/stripeWebhooks.ts) header) and this plan does not add
one. Instead, three unique constraints carry it:

1. `referral_commissions (kind, source_type, source_id)` — Stripe redelivering `invoice.paid` five
   times yields exactly one accrual. Keyed on the *business object*, which is strictly better than
   an event id: two different events describing the same invoice still collapse.
2. `referral_conversions (workspace_id)` — a replayed checkout session can't re-convert or restart
   the 12-month window.
3. `affiliate_payouts (affiliate_id, currency) WHERE status = 'pending'` — a double-clicked payout
   fails on the index; the route turns Postgres `23505` into a 409.

Note the partial-index conflict-target syntax, which is required and easy to get wrong:

```sql
ON CONFLICT (kind, source_type, source_id) WHERE source_id IS NOT NULL DO NOTHING
```

---

## Hard constraint: no transactions

[`server/src/ports/db.ts`](server/src/ports/db.ts) exposes `query()` only, and
[`workspaceInviteAccept.ts:105`](server/src/routes/workspaces/workspaceInviteAccept.ts#L105) states
why: *pool queries may hop connections, so `BEGIN`/`COMMIT` across `query()` calls is unsafe.*

**Every multi-row mutation in this feature must be a single statement with data-modifying CTEs.**
That governs the conversion insert, the accrual, the reversal, and the payout sweep. Do not add a
transaction port for this.

---

## Attribution flow, end to end

```
click     app.recordio.io/r/johndoe   (or /?ref=johndoe)
            └─ captureReferralOnLoad(): cookie rdio_ref + POST /referral-click  →  affiliate_clicks
            └─ replaceState to /  →  logged-out AuthPage, branded, "John sent you — 25% off"
signup    Google OAuth → DB trigger creates workspace + profile (no server hook exists)
            └─ webapp POSTs /referral-claim {token}                                  →  referral_attributions  (PK = user)
checkout  /stripe-checkout, owner-only
            └─ server resolves attribution → discounts:[{coupon}] + metadata.referralCode
paid      checkout.session.completed
            └─ same statement that upserts subscriptions also inserts               →  referral_conversions   (UNIQUE = workspace)
renewals  invoice.paid  (every cycle, forever)
            └─ stripe_customer_id → subscriptions.workspace_id → conversion         →  referral_commissions
refunds   credit_note.created                                                        →  negative reversal row
```

The user→workspace hop happens **exactly once**, at checkout, where both ids are in the session
metadata. Everything after that is purely workspace-keyed. That is the answer to "attributions
attach to users but subscriptions are keyed by workspace".

### 1. The link — handled entirely in the webapp

Both forms are accepted and behave identically: **`app.recordio.io/r/<code>`** (the pretty one
creators say out loud and put in descriptions) and **`app.recordio.io/?ref=<code>`**.

All of it lives in `captureReferralOnLoad()` in a new `webapp/src/referral/referralCode.ts`, called
from `webapp/src/main.tsx` at module scope *before* `initSentry()` and before React mounts:

1. Read the code from `location.pathname` (`/r/<code>`, tolerating a trailing slash) or `?ref=`.
2. Validate the shape against `^[a-z0-9][a-z0-9_-]{2,31}$`, lowercased. Bail silently on anything else.
3. Mint or reuse a `visitorId` (`crypto.randomUUID()`, persisted in the same cookie).
4. Write the cookie and mirror to `localStorage`.
5. POST `referral-click` — fire-and-forget, `.catch(() => {})`.
6. `history.replaceState` to `/` so the code never gets shared, screenshotted, or carried into the
   OAuth `redirectTo` (which is built from `pathname + search`).

```
rdio_ref = <code>.<visitorId>
Domain=recordio.io; Path=/; Max-Age=5184000; SameSite=Lax; (Secure in prod, omitted on localhost)
```

- **No timestamp, no signature.** The authoritative click time is the `affiliate_clicks` row's
  `occurred_at`, looked up by `visitorId` — see "The click row is the trust anchor" above. Nothing in
  the cookie needs to be trusted, so nothing in it needs to be signed.
- **`Domain=recordio.io` rather than host-only**, even though set and read are both on
  `app.recordio.io`. It costs one attribute and keeps the option of the marketing site participating
  later without a cookie-name migration. Drop the attribute for a host-only cookie if you prefer —
  it's the only line that changes, and `__Host-rdio_ref` then becomes available.
- `SameSite=Lax` — traffic arrives as a cross-site top-level navigation from YouTube/X, and Lax
  covers that plus the Google OAuth bounce-back. `Strict` would drop the cookie on first entry.
- Never overwrite a `localStorage` entry that has already been attributed.

⚠️ **`/r/<code>` must not reach [`App.tsx`](webapp/src/App.tsx)'s route matching.** It has no router,
and an unmatched path falls through to `DashboardPage` behind the auth gate. Because
`captureReferralOnLoad()` runs before React mounts and `replaceState`s to `/`, React only ever sees
`/`. Two consequences for the implementation: the capture must be synchronous and unconditional (not
inside a `useEffect`), and `/r/*` needs no entry in `isGatedRoute()`.

⚠️ **Cloudflare Pages must serve `index.html` for `/r/*`.** The SPA fallback that already makes
`/video/{slug}` work covers this, but confirm it after the first deploy — a 404 here is silent
failure for every creator link.

### 2. The sign-in page is now the landing surface

A logged-out visitor to `/` gets [`AuthPage.tsx`](webapp/src/auth/AuthPage.tsx). When a referral code
is present, show the offer there: *"John sent you — 25% off your first 3 months."* Resolve it with
`referral-resolve` (public, rate-limited) using the code already captured from the cookie or `?ref=`.

This is a conversion lever that didn't exist when links pointed at the marketing homepage, and it
also gives the viewer visible confirmation that the creator's link worked. Keep it to one line above
the existing "Continue with Google" button — do not redesign the page. ⚠️ Load the `ui-guidelines`
skill first.

### 3. What still can't be attributed

Two gaps remain, and both are irreducible:

1. **Different browser, profile, or device** between the click and the signup (clicked on a phone,
   signed up on a desktop).
2. **Install-first users** who find the extension in the Chrome Web Store without ever seeing the
   link.

**The Chrome Web Store strips every parameter** — there is no supported way to carry an install-time
value into an MV3 extension, so nothing can route attribution through it. Say this plainly in the
creator-facing terms.

The backstops, in order of value:
1. **The manual code field** at checkout. This is the real answer for both gaps, and it's the thing
   creators will actually say out loud in a video.
2. **Mirror the code into `localStorage`** on first sight. Cheap (~5 lines) and covers the visitor
   who clicks, leaves, and comes back a week later in a browser that has since evicted the cookie.

### 4. Claiming the attribution

Capture (step 1) is anonymous and happens on every page load. **Claiming** needs a session and must
happen exactly once per user.

Inside the existing
`if (AuthManager.subscriptionFetchedForUserId !== session.user.id)` block in
[`AuthManager.ts:180`](webapp/src/auth/AuthManager.ts#L180), after `loadDefaultWorkspace` resolves so
`ready` is never delayed by a marketing call:

```ts
void attributeReferral(session.user.id);   // fire-and-forget
```

- No-op when `getImpersonation()` is set, matching how `webapp/src/analytics/index.ts` gates every
  call — **and reject it server-side too** when `req.user.impersonatedBy` is present. Otherwise an
  admin poking at an account mints an attribution.
- Write a per-user `localStorage` sent-marker on any *terminal* response so it never re-fires; leave
  it unset on a network error so the next load retries.
- Don't delete the cookie on success — a household or team can legitimately produce two signups.

### 5. Not attributing pre-existing users — enforce on the server

Client-side "was this a fresh signup?" is unreliable: production signup is a full-page Google OAuth
redirect, and the DB trigger has already created the workspace before any app code runs, so
`SIGNED_IN` looks identical for a new and a returning user. Use the authoritative facts in
`referralClaim.ts`. The client sends `{ code, visitorId }`; **every timestamp comes from our own
tables, none from the client:**

```sql
WITH me AS (SELECT created_at FROM user_profiles WHERE user_id = $1),
click AS (                       -- the trust anchor: server-written, unforgeable click time
    SELECT c.id, c.occurred_at, c.affiliate_id
    FROM affiliate_clicks c
    JOIN affiliates a ON a.id = c.affiliate_id
    CROSS JOIN me
    WHERE a.code = lower($2)
      AND c.visitor_id = $3
      AND c.occurred_at <= me.created_at                          -- the click preceded the signup
      AND me.created_at <= c.occurred_at + interval '60 days'     -- and is inside the window
    ORDER BY c.occurred_at DESC LIMIT 1        -- the LATEST qualifying click
)
-- then attribute when, additionally:
--   affiliate.status = 'active' AND affiliate.user_id <> :userId  -- no self-referral
--   the user owns no workspace with a `subscriptions` row         -- never-paid only
-- ON CONFLICT (referred_user_id) DO UPDATE ... WHERE locked_at IS NULL
```

⚠️ **The window predicates must live inside the click selection, not after it.** Picking the row
first and testing it second is wrong in both directions, and neither failure is obvious:
- *Latest click, unconditionally:* a visitor who clicks Monday, signs up Wednesday, then clicks again
  Saturday gets the Saturday row — `created_at >= occurred_at` fails and a legitimate referral is
  silently dropped.
- *Earliest click, unconditionally:* a visitor who clicked two years ago and again yesterday gets the
  two-year-old row and fails the 60-day bound, dropping a referral that yesterday's click earned.

Filtering first and taking the latest survivor is correct in every case.

`user_profiles.created_at` is written by the signup trigger, so it *is* the signup timestamp — no
`auth.users` read needed.

**`created_at >= click.occurred_at` is the entire pre-existing-user guard, and it is sufficient on
its own.** A user who signed up a year ago and clicks a referral link today produces a click row
stamped *today*, so their `created_at` is a year older and the claim is refused. Do **not** add a
separate "account must be younger than N hours" cap on top: the claim fires on every app load while
the cookie is present, so it would reject the normal YouTube funnel — click Monday, install the
extension, actually sign up Saturday — even though the cookie is valid for 60 days. The upper bound
is the attribution window measured from the click, not the account's age measured from now.

**When `click` is empty, the cookie path declines** — it does *not* silently fall through to the
manual path's looser rules. A cookie with no qualifying click row is missing the only evidence we
trust, and widening automatically would let a passive link click attribute any existing free user.

The recovery is the manual field, and it should be nearly invisible: **when the cookie holds a code
but `referral-status` returns null, prefill `ReferralCodeField` with that code and expand it.** The
user sees "25% off — Apply" with the code already filled, one click from the discount they were
promised on the sign-in page. That turns an ad-blocked beacon from a lost referral into one extra
click.

### The manual-code path is deliberately looser

`/referral-claim` via cookie requires a signup that post-dates a click. The **manual code** typed at
checkout requires only that *the user has never had a paying subscription* — no click, no recency.
So a free or lapsed-trial user from six months ago **can** be attributed by typing a creator's code.

That is intentional: converting someone who already tried the product and bounced is real value the
creator created, and a spoken code in a video is the only thing that reaches cross-device and
install-first viewers. The cost is that it's the softer path — a user who would have converted
anyway can type a code they found and cost us 25% commission plus a 25% discount. Acceptable while
codes are invite-only and shared in videos rather than published on coupon sites.

**If that trade stops being acceptable**, the tightening is one predicate: require a matching
`affiliate_clicks` row for the same `visitor_id` within 60 days, instead of accepting a bare code.
The click data is already being recorded for exactly this reason.

---

## Stripe discount

**One shared coupon per billing interval, passed explicitly as `discounts: [{ coupon }]` when the
server has resolved an eligible attribution. Never set `allow_promotion_codes`.**

Stripe forbids combining the two, so it's one or the other. Owning code entry ourselves means a
discount can never be granted without a matching row in our tables — no reconciling payouts out of
Stripe's redemption reports, and the client never passes a code to `/stripe-checkout`, so a discount
can't be forged by editing a request body.

### Automatic *and* code — how the two paths relate

The discount applies **automatically** whenever the server can resolve an attribution for the
workspace. The code field is a fallback, not the primary mechanism. Both exist because they serve
structurally different halves of the audience:

| | Automatic (cookie) | Typed code |
|---|---|---|
| Covers | Clicked the link, converts on the same browser | Watched on a phone/TV and bought on a laptop; already had an account; cookie evicted |
| Friction | None | A field to find and fill — real drop-off |
| Leak risk | Low | Codes end up on coupon sites; we pay commission on organic conversions |
| Build cost | Cookie + click table + capture module (~1 file in the webapp, 1 route) | ~100 lines on top of the above |

**Why the code is load-bearing here specifically:** Recordio is a Chrome extension, so it can't be
installed on a phone. A YouTube audience is heavily mobile-watched and desktop-converted, which means
a structural share of any creator's viewers will arrive on a second device with no cookie. A spoken
code is the only thing that survives that, and the only thing a creator can say out loud.

**One identifier for both.** `affiliates.code` is the link slug *and* the typed code:
`app.recordio.io/r/johndoe` ↔ `JOHNDOE`. Stored lowercase (the CHECK constraint enforces it), matched
with `WHERE code = lower($1)`, displayed uppercase. One thing for the creator to communicate.

**When both are present and they disagree** — cookie says A, the user types B — **B wins.** That
falls out of the `referral_attributions` upsert (`DO UPDATE ... WHERE locked_at IS NULL`), and it's
the right rule: an explicit action beats a passive cookie. After the first conversion `locked_at` is
set and neither can change it.

**Because the automatic path is invisible, it has to be shown.** A viewer who was promised 25% off
and sees a normal price will assume the link didn't work. Three surfaces, all already in this plan:
the referral line on the logged-out sign-in page, the applied-discount row in `BillingSection` fed by
`referral-status`, and Stripe Checkout's own discount line. Never rely on the last one alone — by
then they've already decided.

**If you ever need to cut scope**, code-only is the coherent smaller version (it drops the Function,
the cookie, `referral-click`, and the capture module). It is not recommended: a referral program with
no link is a weak pitch to a creator, and the link half would be rebuilt almost immediately —
especially now that it's one webapp file and one route rather than a separate deploy artifact.

### Yearly needs its own coupon — flag this before creating them

"25% off the first 3 months" has no natural meaning on an annual plan, which bills **one** invoice.
Per-seat list price is $15/mo monthly, $144/yr yearly ([`webapp/src/billing/prices.ts`](webapp/src/billing/prices.ts)).

| Coupon | Customer year 1 | Creator year 1 (25%) | Share of gross given away |
|---|---|---|---|
| Monthly: `25% off, repeating, 3 months` | $168.75 | $42.19 | ~34% |
| Yearly **(recommended)**: `6.25% off, once` | $135.00 | $33.75 | ~33% |
| Yearly if we naively reused 3-month/25%: | $108.00 | $27.00 | **~46%** |

6.25% of an annual invoice is exactly three months' worth of a 25% discount, so both intervals cost
the same and the pitch stays "25% off your first three months". Stripe accepts fractional
`percent_off` to two decimals. If you'd rather say "25% off your first year" on annual, that's the
third row and a materially different deal — decide before creating the coupons, it's a one-line
config change either way.

Create both **by hand in the Stripe dashboard** (test + live). A Stripe API call must never sit in
the checkout path.

### Code changes

- [`server/src/ports/stripe.ts`](server/src/ports/stripe.ts) — `StripeCheckoutSessionParams` gains
  `discounts?: Array<{ coupon: string }>` (keep Stripe's snake_case, per the port's stated
  convention). Add `StripeInvoice` and `StripeCreditNote` payload types next to `StripeCheckoutSession`.
- [`server/src/adapters/stripe.ts`](server/src/adapters/stripe.ts) — spread conditionally so an
  absent field never becomes `discounts: []`.
- [`server/test/fakes/fakeStripe.ts`](server/test/fakes/fakeStripe.ts) — no structural change; it
  already records whole param objects, so tests assert `deps.stripe.checkoutSessions[0].discounts`.
- [`server/src/routes/billing/stripeCheckout.ts`](server/src/routes/billing/stripeCheckout.ts) —
  accept optional `referralCode` (the manual path: upsert the attribution first), then resolve the
  workspace's attribution and attach `discounts` + additive `metadata.referralCode`.
  **Never block a purchase over a referral problem** — an invalid or self-referral code is ignored
  and checkout proceeds at full price.

⚠️ [`handleCheckoutCompleted`](server/src/routes/billing/stripeWebhooks.ts) **throws** when
`metadata.userId`/`workspaceId` are missing. Metadata changes must be strictly additive.

---

## Commission engine

### New webhook events (additive switch cases)

| Event | Why this one | Action |
|---|---|---|
| **`invoice.paid`** | The only event that fires on **every renewal**, and only when money actually moved. `billing_reason` covers `subscription_create`, `subscription_cycle`, `subscription_update`. | Accrue |
| **`credit_note.created`** | The only refund-shaped event that still carries `invoice` in this SDK version. **This is what makes the 30-day hold mean anything** — without it the hold just delays paying on refunded money. | Reverse |
| `charge.dispute.created` | In SDK v22 / API `2026-06-24.dahlia`, `Invoice` has no `payment_intent` and `Charge` has no `.invoice`, so a dispute can't be resolved to an invoice without an extra API round-trip. | **Log a warn only.** The 30-day hold catches most; admin voids manually |
| `invoice.payment_succeeded` | Duplicate of `invoice.paid` for our purposes | Not subscribed |
| `invoice.payment_failed` | Nothing accrued; successful dunning fires `invoice.paid` | Not subscribed |

⚠️ **SDK shape trap:** in this version `Invoice` has **no top-level `subscription`**, no `charge`,
no `payment_intent`. Resolve by `invoice.customer` (still top-level). The webhook payload follows the
*endpoint's* dashboard API version, not the SDK's, so read defensively — accept both
`invoice.parent.subscription_details.subscription` and legacy `invoice.subscription`, exactly like
the existing `itemPeriodEnd()` fallback does.

Logic lives in `server/src/services/referralCommissions.ts`, mirroring how `entitlements.ts` and
`seatBilling.ts` are factored out; `stripeWebhooks.ts` stays a dispatcher.

### Accrual — one statement

```sql
WITH sub AS (
    SELECT s.workspace_id FROM subscriptions s WHERE s.stripe_customer_id = $1 LIMIT 1
),
conv AS (
    SELECT c.id, c.affiliate_id, c.workspace_id, c.commission_rate_bps, c.clearing_days
    FROM referral_conversions c
    JOIN sub ON sub.workspace_id = c.workspace_id
    JOIN affiliates a ON a.id = c.affiliate_id
    JOIN workspaces w ON w.id = c.workspace_id
    WHERE c.status = 'active' AND a.status = 'active'
      AND $2::timestamptz < c.commission_ends_at   -- the 12-month window, enforced ONLY here
      AND a.user_id <> c.referred_user_id          -- self-referral belt
      AND a.user_id <> w.owner_id                  -- ...and braces
)
INSERT INTO referral_commissions (...)
SELECT conv.affiliate_id, conv.id, conv.workspace_id, 'accrual', 'open',
       round($3::numeric * conv.commission_rate_bps / 10000.0)::int,
       $4, $3::int, conv.commission_rate_bps, 'invoice', $5, $5, $6,
       $2::timestamptz, $2::timestamptz + make_interval(days => conv.clearing_days)
FROM conv
WHERE $3::int > 0
ON CONFLICT (kind, source_type, source_id) WHERE source_id IS NOT NULL DO NOTHING;
```

Behaviour contract:
- **Unknown customer** (`sub` empty) → nothing inserted, so the handler must then
  `SELECT 1 FROM subscriptions WHERE stripe_customer_id = $1` and **throw** if absent, mirroring
  `handleSubscriptionUpdate`. That 500 makes Stripe retry until `checkout.session.completed` has
  landed, which is what closes the first-invoice race.
- **Known customer, no conversion** → zero rows, 200. The overwhelmingly common path. Never throws.
- **Window expired** → zero rows.

The existing `stripe_event_at` ordering guard is deliberately **not** extended here: an out-of-order
`invoice.paid` is still a real payment for a real invoice, and the unique index makes order irrelevant.

### Reversal on `credit_note.created`

Find the accrual by `stripe_invoice_id`, insert a negative row capped at what's left:

```sql
-LEAST(round($2::numeric * t.commission_rate_bps / 10000.0)::int,
       t.amount_cents - t.already_reversed)
```

- The cap means multiple partial credit notes each get their own row and can never over-reverse.
- **The reversal inherits the target's `clears_at`.** Otherwise a cleared negative row could be swept
  into a payout while its uncleared positive twin sat behind it, producing a wrong (even negative)
  payout.
- If the accrual is already `paid`, the negative row is a **clawback** that nets against the
  creator's next earnings. `availableCents` can legitimately go negative — clamp in the UI only,
  never in the data.

### Conversion at checkout

Replace the bare `INSERT INTO subscriptions` in `handleCheckoutCompleted` with a three-CTE statement:
upsert the subscription → insert the conversion (snapshotting rate/window/clearing) → stamp
`referral_attributions.locked_at`. If the buyer has no attribution, the second CTE is empty and
behaviour is byte-identical to today for the ~95% of checkouts with no referral. That property is
worth a test of its own.

### Money rules

- **Integer cents everywhere.** `int4`, not `numeric`, not `bigint` — keeps JS `number` exact.
- **Currency stored per row**, lowercase ISO-4217, taken verbatim from `invoice.currency`. Balances
  are grouped by currency; a payout carries exactly one. No FX conversion, ever — that's an
  accounting decision, not a code one.
- **Rounding** is `round(basis::numeric * rate_bps / 10000.0)::int`, half-away-from-zero, computed in
  **exactly one place** (the SQL). Never compute money in TypeScript.
- **Basis** is `GREATEST(0, LEAST(invoice.total_excluding_tax ?? invoice.total, invoice.amount_paid))`:
  - **net of the referral discount** — we can't pay commission on money we never collected. Say this
    in the creator terms.
  - **net of tax** — tax is remitted to a government, not revenue.
  - **net of credits** — the `amount_paid` clamp handles credit-funded invoices.
  - **gross of Stripe fees** (~2.9% + 30¢) — deliberate. Fees aren't on the invoice object; getting
    them means a Balance Transaction fetch per invoice inside the webhook, for ~0.6% of the payout.
    Price fees into the headline rate instead.
  - `amount_paid = 0` → **no row at all**, so $0 trial invoices never pollute the ledger.
- **Balance vocabulary**, defined once in `server/src/services/affiliateBalances.ts`:

  | Name | Definition |
  |---|---|
  | `pendingCents` | `status='open' AND payout_id IS NULL AND clears_at > now()` |
  | `availableCents` | `status='open' AND payout_id IS NULL AND clears_at <= now()` |
  | `processingCents` | `status='open' AND payout_id IS NOT NULL` |
  | `paidCents` | `status='paid'` |
  | `lifetimeCents` | `status <> 'void'` |

### Payout sweep — one statement

```sql
WITH eligible AS (
    SELECT id, amount_cents FROM referral_commissions
    WHERE affiliate_id = $1 AND currency = $2
      AND status = 'open' AND payout_id IS NULL
      AND clears_at <= $8::timestamptz        -- ← the 30-day hold, as a predicate
),
totals AS (SELECT COALESCE(SUM(amount_cents),0)::int AS total FROM eligible),
p AS (
    INSERT INTO affiliate_payouts (...) SELECT ... FROM totals t WHERE t.total >= $7::int
    RETURNING id, amount_cents
)
UPDATE referral_commissions c SET payout_id = (SELECT id FROM p), updated_at = now()
FROM eligible e
WHERE c.id = e.id
  AND c.payout_id IS NULL        -- ← re-check: all CTEs share one snapshot
  AND EXISTS (SELECT 1 FROM p)
RETURNING (SELECT id FROM p) AS payout_id, (SELECT amount_cents FROM p) AS amount_cents;
```

The inner `payout_id IS NULL` re-check is not decoration — without it a concurrent sweep could
reassign already-swept rows. With it plus the partial unique index, a double-submit either 409s or
no-ops. Catch `23505` → 409 `open_payout_exists`.

---

## Edge cases, decided

| Case | Outcome | Why |
|---|---|---|
| Referred user **joins someone else's** workspace | **No commission** | Conversion comes from a checkout the referred user initiated, and `/stripe-checkout` is owner-only. Commission follows **the payer**. Otherwise: invite a referred friend into a big company's workspace and skim it |
| Referred user **owns several** paying workspaces | **Each converts and accrues** | Real incremental revenue. Each gets its own window. `referral_conversions_user_idx` exists so abuse review can spot implausible counts |
| Owner not referred, but **members** are | **No commission** | Same rule; state it in the route doc comment |
| **Self-referral** | **Blocked at four points** | `/referral-claim`, `/stripe-checkout`, the conversion CTE, the accrual CTE. Belt and braces — it's the #1 way these programs bleed money |
| Clicks Monday, installs the extension, **signs up Saturday** | **Attributed** | The bound is the 60-day attribution window measured from the click, not the account's age. This is the normal YouTube funnel and must not be rejected |
| Signed up a year ago, **clicks a referral link today** | **No attribution via the link** | Their `created_at` predates the new click row's `occurred_at`. They can still be attributed by typing the code manually |
| User **already paid** before ever clicking | **No attribution**, on either path | Same "ever-pro one-way door" predicate `entitlements.ts` already documents. Referral money is for *new* customers |
| Cancel at month 3, **re-subscribe** at month 10 | **Commissions resume** | The conversion row survives; the window is wall-clock, not "12 billing cycles" |
| **Stripe customer id changes** on re-subscribe (our checkout always creates a new customer via `customer_email`) | **Continues** | Conversion is keyed on `workspace_id`; the checkout upsert rewrites `stripe_customer_id` on the same workspace row |
| Annual plan renewing at **month 12 + 1 day** | **No accrual** | The window is calendar time. Intentional |
| Affiliate **suspended** mid-window | Accruals stop immediately; already-accrued rows stay payable unless voided | `a.status = 'active'` in the accrual CTE |
| Admin **impersonating** a user | No attribution | Guarded on both client and server |

---

## Routes

All `POST`, kebab-case `{asset}-{verb}`, one file each, registered in
[`server/src/app.ts`](server/src/app.ts), typed in a new `shared/api/affiliates.ts` and added to
`ApiRoutes` in [`shared/api/index.ts`](shared/api/index.ts).

⚠️ `ApiRoutes` is not exhaustive yet — a route omitted from it silently falls through to
`invokeFunction`'s untyped overload and loses all type checking.

**Public / attribution** — `app.optionalUser` or `requireUser`, each with its own rate limit (use the
`config: { rateLimit: ... }` pattern from `sharedVideoGet.ts`):

| Route | File | Notes |
|---|---|---|
| `referral-click` | `server/src/routes/referrals/referralClick.ts` | Public, 30/min per IP. `visitorId` must be `Type.String({ format: 'uuid' })` — free text here is an index-poisoning vector. Hash the IP server-side (never store it raw), take `referer` from the body but the **IP from the connection**. Unknown code → 200 with no row (don't leak). Filter obvious bot user-agents before inserting. **This row is the attribution trust anchor, not just an analytics counter** — `referral-claim` reads its `occurred_at` |
| `referral-resolve` | `.../referralResolve.ts` | 60/min. `{ code }` → `{ valid, affiliateName, discount }`. **Collapse "unknown" and "suspended" into the same `valid:false`** — don't leak which codes exist |
| `referral-claim` | `.../referralClaim.ts` | `requireUser`, 20/min. Fully idempotent; the webapp may fire it on every load |
| `referral-status` | `.../referralStatus.ts` | `requireUser`, workspace-scoped → `{ code, percentOff, durationMonths } \| null`. **Do not extend `subscription-get`** — it's on the session bootstrap hot path |

**Creator-facing** — `requireUser`, own row only:

| Route | File | Notes |
|---|---|---|
| `affiliate-get` | `server/src/routes/affiliates/affiliateGet.ts` | `{}` → `{ affiliate \| null, link, stats, balances, recentPayouts }`. Returns `null` for non-affiliates so the page can render a "not an affiliate" state |
| `affiliate-referral-list` | `.../affiliateReferralList.ts` | Paged. **Privacy: never return the referred user's email or name** — `{ convertedAt, commissionEndsAt, status, lifetimeCommissionCents }` only |

**Admin** — `preHandler: [app.requireUser, requireAdmin(opts.adminEmails)]`, wired like
`adminUserListRoutes`:

`admin-affiliate-list` · `admin-affiliate-create` · `admin-affiliate-update` ·
`admin-commission-list` · `admin-commission-void` · `admin-commission-adjust` ·
`admin-payout-create` · `admin-payout-mark-paid` · `admin-payout-cancel`

`admin-affiliate-create` takes `{ userId, code, displayName, payoutMethod, payoutEmail, note }` —
invite-only means this is the *only* way an affiliate row is born.

---

## Config

Add to [`server/src/config.ts`](server/src/config.ts) as **required** (per the project convention —
no optional-with-degrade groups):

```
REFERRAL_IP_SALT                # salt for ip_hash on affiliate_clicks
REFERRAL_BASE_URL               # https://app.recordio.io — server owns the creator's link
STRIPE_REFERRAL_COUPON_MONTHLY  # 25% off, repeating, 3 months
STRIPE_REFERRAL_COUPON_YEARLY   # 6.25% off, once
```

Four, not six: dropping the Pages Function drops `REFERRAL_COOKIE_SECRET` and
`REFERRAL_INGEST_SECRET` with it. **No Cloudflare Pages env changes at all** — neither project needs
a secret.

⚠️ `loadConfig()` calls `process.exit(1)` on any missing required var. **Set all four in Railway
and `.env.test` before deploying the server**, or the deploy dies at boot. Thread them into
`buildApp` as one `referral` options group rather than four more top-level keys — `app.ts` already
carries eight ad-hoc option fields.

---

## Creator stats page (read-only)

New `webapp/src/pages/affiliate/AffiliatePage.tsx`, routed in
[`App.tsx`](webapp/src/App.tsx) at `path === '/affiliate'` (gated, auth required). Shows: the link
with a copy button, clicks / signups / paying customers, `pendingCents` + `availableCents` +
`paidCents`, a short list of conversions (**no PII**), and recent payouts. Non-affiliates get a plain
"you're not in the program" state — invite-only, so there's no CTA.

Also new: `webapp/src/billing/ReferralCodeField.tsx`, mounted inside the `!hasActivePlan && isOwner`
upgrade card in [`BillingSection.tsx`](webapp/src/pages/settings/BillingSection.tsx) (which is already
~500 lines — put it in its own file). Collapsed "Have a referral code?" → input → Apply. On success
show `✓ Code JOHNDOE applied · 25% off for 3 months` and re-render the price line with a strikethrough.
Keep the discount math display-only, consistent with the note in `prices.ts` that the server and
Stripe own the real amounts. Hide the field entirely when `hasActivePlan` — discounting an *already
active* subscription is a Stripe subscription update with proration, explicitly out of scope.

⚠️ **Load the `ui-guidelines` skill before writing either component.**

---

## Paying creators — the manual runbook

Nothing in this system moves money to a creator. Stripe charges the customer, the money lands in our
balance, and it stays there. The feature is a **ledger** that answers one question: *how much do I
owe each creator right now?* Payment happens by hand, outside the code. At a handful of creators this
is the right call, not a compromise — roughly ten minutes a month.

**Monthly, on a fixed day:**

1. Open the admin affiliates page. Each creator shows `availableCents` — commissions whose
   `clears_at <= now()`, not yet attached to a payout. Anything newer than 30 days is still
   `pendingCents` and deliberately not offered.
2. Anyone at or above the **$50 minimum** gets paid. Below that, the balance simply rolls forward —
   there is nothing to do, no record to create. The threshold is a constant in
   `server/src/services/referralProgram.ts` (`MINIMUM_PAYOUT_CENTS = 5000`), not a DB column;
   `admin-payout-create` returns 409 `below_minimum` under it.
3. Click **Create payout** → the sweep statement stamps every eligible commission with the new
   `payout_id` and freezes the amount. The partial unique index means a double-click 409s rather
   than paying twice.
4. Send the money — PayPal or Wise, whichever is on the creator's row. PayPal has wider
   international creator coverage; Wise is materially cheaper once amounts get real. The creator
   picks at onboarding and admin stores it (`payout_method`, `payout_email`, `payout_details`).
5. Paste the transaction reference into **Mark paid** → `admin-payout-mark-paid` flips exactly the
   swept rows to `status='paid'`, stamps `paid_at` and `marked_paid_by`, and the creator's
   `/affiliate` page shows the payout in their history.

If a transfer fails or you create a payout by mistake, `admin-payout-cancel` releases the rows
(`payout_id = NULL`) and the balance returns to `availableCents`. That's why cancel exists and why
commissions are never deleted.

**What makes this safe** is the combination of the 30-day hold and the `credit_note.created`
reversal: by the time a commission is offered for payout, any refund has already netted it out. The
hold on its own would only delay paying on refunded money — the reversal handler is what gives it
teeth. If a refund lands *after* payment, the negative row stands as a clawback against the
creator's next earnings; `availableCents` can legitimately go negative and must be clamped in the UI
only, never in the data.

**Tax and paperwork (outside the code, do it before the first payment):** creators are independent
contractors. Collect a **W-9** from US creators and a **W-8BEN** from everyone else, and have them
invoice you. US creators paid more than **$600 in a calendar year** need a 1099-NEC.

### When to stop doing this by hand

The forcing function is usually tax and volume, not effort. Revisit somewhere past **10–15 active
creators**, or when a single month's payouts are large enough that a fat-fingered transfer hurts.
At that point the options are Stripe Connect Express (creators onboard, Stripe handles KYC and
transfers, and it files 1099s — but it's a real integration) or a payout service (PayPal Payouts
API, Wise Batch, Tipalti). Nothing in this schema blocks either: `affiliate_payouts` already carries
`method`, `destination`, and `reference`, so an automated rail just fills those fields itself instead
of an admin typing them.

---

## Implementation order

| Step | Files | Done when |
|---|---|---|
| **1. Schema** | one migration; regenerate `supabase/sql/tables/*.sql` | `supabase db reset` applies clean; a scratch test inserts each unique-index duplicate twice and gets `23505` |
| **2. Attribution capture** (no money) | `shared/api/affiliates.ts` + `index.ts`; `server/src/services/referralProgram.ts`, `referralAttribution.ts`; routes `referralClick/Resolve/Claim/Status`; `server/test/helpers/db.ts` gains `seedAffiliate`/`seedAttribution`/`seedConversion`/`seedCommission` + deletes, and `deleteAuthUsers` grows referral cleanup | Click dedupes by `(affiliate, visitor, day)`; claim is idempotent and refuses self-referral / unknown code / suspended / ever-pro; **a signup predating its click is refused, and one 5 days after it is accepted**; last-touch overwrites until `locked_at` |
| **3. Discount plumbing** | `ports/stripe.ts`, `adapters/stripe.ts`, `test/fakes/fakeStripe.ts`, `stripeCheckout.ts` | Coupon forwarded with an attribution, absent without one; `referralCode` in the body creates the attribution; self-referral code ignored **and checkout still succeeds** |
| **4. Conversion at checkout** | `stripeWebhooks.ts` — `handleCheckoutCompleted` CTE only | **Existing subscription assertions unchanged** (the point: invisible for non-referred checkouts); snapshots written; `locked_at` stamped; replay creates exactly one conversion |
| **5. Commission engine** | `ports/stripe.ts` payload types, `services/referralCommissions.ts`, `stripeWebhooks.ts` switch, `logging.ts` event catalog | **Renewal accrues again** (the headline test); redelivery accrues once; unknown customer throws; no conversion → 200 + no row; past `commission_ends_at` → no row; `amount_paid=0` → no row; `total_excluding_tax` preferred; full + two partial credit notes reverse without over-reversing; clawback on a `paid` accrual is negative; legacy `invoice.subscription` shape still resolves |
| **6. Balances + creator routes** | `services/affiliateBalances.ts`, `affiliateGet.ts`, `affiliateReferralList.ts` | Buckets sum correctly including a negative clawback; `clears_at` splits pending from available; referral list leaks no PII |
| **7. Admin payouts** | the nine `server/src/routes/admin/admin*.ts` + `app.ts` | Non-admin 403 on every route; sweep total matches `availableCents`; concurrent sweep 409s; below-minimum 409s; mark-paid flips exactly the swept rows; cancel restores `availableCents`; void refuses a paid or in-payout row |
| **8. Webapp** | `webapp/src/referral/referralCode.ts` (+ test), `main.tsx`, `AuthManager.ts`, `AuthPage.tsx` (referral line), `pages/affiliate/AffiliatePage.tsx`, `billing/ReferralCodeField.tsx`, `analytics/index.ts` | See verification below. There is no step 9 — dropping the Pages Function folded the link handling into this step |

Steps 1–7 are independently shippable behind the absence of any affiliate rows: with no
`affiliates` row, every new code path is a no-op.

---

## Verification

**Unit / route tests** (`vitest`, `app.inject()` + `createFakeDeps`, mirroring the two-tier split in
`server/test/billing/stripeCheckout.test.ts`):
- Validation tier (no DB): 401 unauthenticated; impersonation token rejected; malformed token →
  `{ attributed: false, reason }`; `referral-click` without the shared secret → 401.
- e2e tier (`describe.runIf(hasTestDb())`, real Postgres): everything in the "done when" column above.
- Token sign/verify round-trip + every rejection (bad sig, truncated, future `ts`, expired, bad code
  shape) in `server/test/referrals/referralToken.test.ts`.
- Cookie read/write branch for `localhost` vs `app.recordio.io` in `webapp/src/referral/referralCode.test.ts`.

⚠️ e2e tests share one Postgres with **no truncation** (`server/test/helpers/db.ts` header) — every
new seed helper must delete what it created.

**Playwright** (`e2e/tests/referral.spec.ts`): `context.addCookies([{ name:'rdio_ref',
value:'testcode.<uuid>', domain:'localhost', path:'/' }])` plus a seeded `affiliate_clicks` row for
that `visitor_id`, sign in as a **freshly created** user (attribution needs `created_at` to post-date
the click row's `occurred_at` — seed both with the service-role key, as `e2e/fixtures/billing.ts`
already does, and cover a signup 5 days after the click and one predating it), load `/`, assert the
attribution row, then open
`/workspace/settings/billing` and assert the discount line. The billing specs already drive Stripe
test mode via `loadStripeEnv()`, so add the test-mode coupon ids and assert the created session's
`total_details.amount_discount`.

**Manual, once, in production** — the part no test covers:
1. `https://app.recordio.io/r/CODE` → the page loads (**not a 404** — that would mean the SPA
   fallback doesn't cover `/r/*`), the URL becomes `/`, `document.cookie` holds `rdio_ref` with
   `Domain=recordio.io; Max-Age=5184000; SameSite=Lax; Secure`, and a click row exists.
2. `/r/CODE/` (trailing slash), `/?ref=CODE`, and `/r/UNKNOWN` all behave — the last writes no cookie
   and no click row.
3. The logged-out sign-in page shows the referral line; sign up with a **new** Google account →
   attribution row with `source='link'`.
4. Sign in with an **existing** account in the same browser → **no** row (`created_at` predates the
   click row's `occurred_at`). Then type the same code manually at checkout on that account →
   attribution **is** created, because the manual path only requires never-paid.
4b. Block `referral-click` in DevTools, then repeat step 3 → **no** automatic attribution, and the
   billing page shows the referral field **pre-filled and expanded** with the code from the cookie.
   One click applies it.
5. Buy Pro → Stripe Checkout shows the discount pre-applied and **no** promo-code box → the webhook
   creates the conversion.
6. Wait for the first renewal (or advance a test-clock subscription in Stripe test mode) → a second
   accrual appears. **This is the single most important thing to confirm** — it's the difference
   between a recurring program and a first-payment bounty.
7. Refund that invoice in Stripe → a negative reversal row appears and `availableCents` drops.
8. Admin impersonate a fresh account → **no** attribution row.

**Ops checklist, once:** create both Stripe coupons (test + live); enable `invoice.paid`,
`credit_note.created`, and `charge.dispute.created` on the **existing** webhook endpoint — no new
endpoint, no new secret; set the four env vars in Railway and `.env.test`. **No Cloudflare changes
and no marketing-site changes** — confirm only that the SPA fallback already serves `index.html` for
`/r/*`.

**Before the first payout:** walk the monthly runbook above once with a real creator — create a
payout, send a token amount, mark it paid, and confirm the creator's `/affiliate` page shows it and
their balance drops. Tax paperwork (W-9 / W-8BEN) must be on file first.

---

## Existing code that will fight this

1. **No transactions** — `Db` is `query()` only; every multi-row write is one CTE statement.
2. **`config.ts` exits on a missing required var** — set all six in Railway *before* deploying.
3. **`ApiRoutes` is not exhaustive** — an unmapped route loses type checking silently.
4. **`App.tsx` has no router** — an unmatched path renders `DashboardPage` behind the auth gate. The
   capture must run at module scope in `main.tsx` and `replaceState` to `/` before React mounts, so
   `/r/*` never reaches route matching.
5. **`handleCheckoutCompleted` throws on missing metadata** — additive metadata only.
6. **Impersonation** — `invokeFunction` sends the impersonation token; guard both sides.
7. **SDK v22 `Invoice` has no `subscription`/`charge`/`payment_intent`** — resolve by `customer`,
   and accept both payload shapes.
8. **Cloudflare Pages SPA fallback must cover `/r/*`** — it already does for `/video/{slug}`, but a
   404 here fails every creator link silently. Confirm after deploy.
9. **Pasted links pick up trailing slashes** — `/r/johndoe/` must parse identically to `/r/johndoe`.
10. **The Chrome Web Store strips every parameter** — only the cookie and the manual code attribute.
11. **`logging.ts` redacts any field named `email`** — log `affiliate.id`, never `payout_email`.
12. **`BillingSection.tsx` is already ~500 lines** — the referral field goes in its own component.
