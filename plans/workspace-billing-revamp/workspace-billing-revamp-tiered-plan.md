# Workspace Permissions & Billing Revamp — High-Level Design

**Status:** In progress — Steps 1–2 shipped 2026-09-01 (see Step log).
**Purpose:** Umbrella reference for the billing/permissions revamp. Each step gets its own
step doc in this folder (`workspace-billing-revamp-step-N.md`), created when that step
starts — not upfront, since earlier steps' outcomes change later steps.

---

## 1. Summary

Collapse Pro vs Teams into a single plan: **Recordio Pro**, per-seat, auto-scaling.
Every user owns exactly **one workspace**, created at signup with a **7-day trial**.
No workspace creation or deletion. Free (post-trial) is permanent: solo, capped
projects, in-browser 1080p export, no share links. Pro unlocks collaboration (seats),
background (cloud) export, 4k, transcription, share links, and uncapped projects.
The bill scales with accepted invites — no seat pre-purchase. Lapse/cancel means
feature downgrade, never data loss. All entitlement checks are enforced server-side.

## 2. Entitlement model

Every workspace is in exactly one state: **trial** (first 7 days + extensions —
never after the workspace has been pro), **pro** (active subscription), or **free**
(everything else). The workspace state governs all members' capabilities inside
that workspace. Per-membership, not
per-person: the same user can be free in their own workspace and a paid seat in
someone else's.

| Capability | Free | Trial (7d per workspace) | Pro |
|---|---|---|---|
| Record + edit | yes | yes | yes |
| In-browser export (1080p) | yes | yes | yes |
| Background export (cloud render) | no | yes | yes |
| 4k export | no | yes | yes |
| Transcription / captions | no | yes | yes |
| Share link (branded watch page) | no | yes | yes |
| Active projects | cap N per user per workspace (start N=2–3) | uncapped | uncapped |
| Collaboration (workspace members) | no — solo | no — solo | yes (creators/admins = seats, viewers free) |

Notes:
- Trial lifts **limits only** — collaboration is never in trial. Free/trial workspaces
  are strictly solo, so "per-creator cap" and "per-workspace cap" coincide there.
- Free tier triggers **zero cloud spend**: no cloud renders, no transcription, no
  hosted shares. Cost exposure is bounded to trial + pro workspaces.
- The distribution story for free users: in-browser render → download the MP4 →
  send it anywhere. They're not blocked from distributing, only from hosted links.

## 3. Core rules (decision log)

**Plan & billing**
- One plan. `subscriptions.plan` and the seats-only-on-teams constraint go away.
  Every subscription has `seats >= 1`. Free = no subscription row.
- Price (decided in Step 1): the existing Pro Stripe prices ($15/mo, $12/mo billed
  yearly) ARE the per-seat price — env vars renamed to `STRIPE_PRICE_ID_*`. Teams
  prices retired from config; existing Teams subscribers stay on their old Stripe
  prices until Step 8 migrates them.
- Upgrade-first flow: owner upgrades (checkout, quantity 1 = themselves), *then*
  invites. Each accepted creator/admin invite increments Stripe quantity with
  proration; removal decrements. Seats are consumed on **acceptance**, never on
  pending invites.
- Viewers never consume a seat. A hidden internal viewer ceiling exists as an abuse
  backstop (not shown in product); at the ceiling the admin sees "viewer limit
  reached — contact support". No `seats * 10` math anywhere user-visible.

**Workspace lifecycle**
- One owned workspace per account, created at signup, undeletable, ownership
  immutable. Users join other workspaces only by invitation. This closes the
  create-workspaces-to-multiply-the-free-cap loophole and removes the need for
  workspace create/delete UI entirely.
- **Owner membership is implicit** (decided 2026-09-01, Step 2): owners have
  NO `workspace_members` row — owner is its own state (`workspaces.owner_id`)
  and implies admin everywhere; unremovable/undowngradable is structural.
  `workspace_members` holds invited members only. Member listings and the
  workspace list synthesize the owner server-side; the owner shows in the
  members table but is not editable there. Billed seats (Step 6) = owner (1)
  + creator/admin member rows.

**Trial**
- Per **workspace** (not per user): `trial_ends_at` on the workspace, set to
  `created_at + 7 days` at signup.
- **One-way door** (decided 2026-09-01): once a workspace becomes **pro** (has ever
  had a subscription), it is permanently ineligible for trial and for trial
  extensions — self-serve and manual alike. Lapse/cancel goes straight to free,
  even if a trial window would otherwise still be open. Enforced when the trial
  moves onto the workspace (Steps 2–3); the Step 1 interim (owner-profile trial)
  accepts the lapsed-subscription-with-live-trial edge until then.
- Interim (Step 1, until Step 2 lands): the server derives a workspace's trial
  state from its OWNER's `user_profiles.trial_ends_at` — same behavior the client
  already had, now enforced server-side behind the entitlements service.
- Self-serve extension, once: +7 days **from the extension date** (works even if the
  trial already lapsed). Extension count is tracked. On extension, show a popup
  inviting a Chrome Web Store review — the extension is granted unconditionally
  *before* the ask (CWS policy forbids incentivized reviews; never condition the
  grant on the review).
- After the one self-serve extension, further extensions go through email to
  john@recordio.io (manual grant).

**Projects & cap**
- The 14-day project auto-expiry for unsubscribed workspaces is **removed**.
- Replaced by an active-project cap on free workspaces: N live (non-deleted)
  projects per user per workspace, counted by `owner_id`. Archiving/deleting frees
  a slot. Over-cap after a lapse or transfer = grandfathered: keep everything,
  block new creation until under cap.
- Enforced server-side at project create/import. Extension-side pre-recording check
  is deferred (extension ships slowly); the import page handles the at-cap moment.

**Sharing & rendering**
- Share links (public watch page) are **trial + Pro**. The watch page carries
  Recordio branding — that's the growth loop; no watermark on video files, no
  badge features (both explicitly rejected).
- Sharing auto-triggers a cloud render behind the scenes (existing mux flow).
  This is invisible plumbing — never surfaced as "cloud render".
- Download is one button, no renderer choice. Free: always in-browser ("preparing
  your video — keep this tab open"), with an ETA measured from early encode
  throughput; when the ETA is long, show a contextual upsell ("Pro renders in the
  background — close the tab, we'll notify you"). Pro: background export by
  default; instant when a current cached render exists.
- Marketing frames it as **background export** (time back, tab freedom) — never
  "faster" (data: only ~20% of local renders are >2x slower than realtime) and
  never "higher quality" (identical pipeline).
- Accepted loophole: a trial/Pro user can share then download the cached file;
  they're entitled anyway. Rate-limit renders per project/day as an edit-spam
  backstop (trial users can otherwise re-render repeatedly for free).

**Lapse / cancellation** (payment drops or subscription canceled)
- Downgrade only — nothing is deleted, nothing goes read-only.
- No new invitations; **pending invitations are revoked**.
- Existing members keep their membership and roles (see open question in Step 7).
- Free entitlements re-apply: per-user-per-workspace project cap (grandfathered),
  no new share links, transcription/4k/background export lock.
- During Stripe dunning (`past_due`): full access + warning banner; downgrade takes
  effect on terminal failure/cancellation.

**Member removal / role downgrade**
- Before a member is removed or downgraded creator→viewer, the admin explicitly
  chooses per their projects: transfer to self / transfer to another member /
  delete (soft-delete with recovery window — never hard-delete). Current code only
  auto-transfers to the caller; this becomes a choice.
- This flow is decoupled from billing — a lapse never force-removes anyone.

**Enforcement principle**
- Every gate above is checked **server-side**. Since Step 1 the server is the
  source of truth: `server/src/services/entitlements.ts` computes the entitlements,
  the share/render/mux/transcribe routes enforce them, and the client renders the
  same payload (delivered via `/subscription-get`, read through `useEntitlements`).
  Remaining gates (project cap, invites, 4k/rate limits) enforce in Steps 4–6.

## 4. Delta vs pre-revamp code

| Area | Pre-revamp | Target | Status |
|---|---|---|---|
| Plans | `pro` / `teams` + seat constraint (`subscriptions.plan`) | single plan, `seats >= 1` | ✅ Step 1 |
| Entitlements | client-computed (`useNonFreeAccess`) | server-side entitlements service, client reads the payload | ✅ Step 1 |
| Trial | `user_profiles.trial_ends_at`, no expiry enforcement | workspace-level `trial_ends_at` + extension tracking, one-way door enforced | ✅ Step 2 (extension flow Step 3) |
| Workspaces | lazy bootstrap on `/workspace-get-default`, `/workspace-create` open | created at signup (trigger), creation/deletion removed, owner membership implicit | ✅ Step 2 (`is_personal` was already dropped pre-revamp, migration `20260512200000`) |
| Project expiry | 14-day auto-expiry for unsubscribed (`projectCreateV2.ts`) | removed; active-project cap instead | Step 4 |
| Share gate | client-only (`Header.tsx`); `/project-share` had no tier check | server-side trial/Pro gate | ✅ Step 1 |
| Cloud render gate | client-only (`DownloadModal.tsx`); `/render-job-create`, `/mux-video-create` unchecked | server-side gate + rate limits | gate ✅ Step 1; rate limits Step 5 |
| Download UX | two-button local/cloud modal | one button, tier-decided, ETA + contextual upsell | Step 5 |
| Seats | `/workspace-seats-set` manual, teams-only | auto-scale on invite accept/remove, route removed | route removed ✅ Step 1 (early — see Step log); auto-scale Step 6 |
| Member removal | auto-transfer to caller | transfer-to-self / transfer-to-other / delete choice | Step 7 |
| Sharing model (`share_policy` private/workspace/public, `project_editors`) | exists | unchanged — already matches target | — |

## 5. Steps

Steps 1–2 are the foundation; 3–7 depend on them but are largely parallelizable;
8 lands last. Each step includes its backend, data, and frontend scope.

### Step 1 — Single plan + server-side entitlements service ✅
*Doc: [`workspace-billing-revamp-step-1.md`](workspace-billing-revamp-step-1.md) — **implemented 2026-09-01**.*

**Goal:** Collapse the plan model and centralize all tier checks in one server-side
service that every route consults.

- Data: drop `plan` column usage + teams constraints; `seats >= 1` on all
  subscriptions; Stripe: single price (monthly/yearly), retire teams prices.
- Server: an entitlements module — given a workspace, returns
  `{ state: free|trial|pro, canShare, canTranscribe, canBackgroundExport, max4k, projectCap, canInvite }`.
  All existing gates (transcribe already server-side; share/render currently not)
  route through it.
- Frontend: `useNonFreeAccess` replaced by server-provided entitlements (via
  session/subscription-get); pricing/checkout UI reduced to one plan.
- Open for step doc: Stripe price migration strategy for existing subscribers
  (grandfather vs migrate); exact entitlements payload shape and caching.

### Step 2 — Workspace lifecycle: one per user, created at signup ✅
*Doc: [`workspace-billing-revamp-step-2.md`](workspace-billing-revamp-step-2.md) — **implemented 2026-09-01**.*

**Goal:** Every account owns exactly one undeletable workspace, born at signup with
the trial attached.

- Data: `trial_ends_at` + `trial_extension_count` (or extensions table with dates)
  on `workspaces`; migrate `user_profiles.trial_ends_at`.
- Server: workspace creation moves to signup (extend the `user_profile_create`
  trigger path or keep lazy bootstrap — decide in step doc; lean signup-trigger
  for determinism); `/workspace-create` removed/blocked; no deletion path; account
  deletion cascades.
- Fixes the signup-trial gap (agent-suggestions #1, decided 2026-09-01 to fix
  here rather than patch the trigger now): the current `user_profile_create`
  trigger stopped setting `user_profiles.trial_ends_at`, so recent signups have no
  trial at all. The workspace-trial move supersedes the profile field; decide the
  backfill for affected accounts in the step doc.
- Entitlements derivation swaps its trial source to `workspaces.trial_ends_at`
  and starts enforcing the one-way door (§3 Trial): a workspace that has ever had
  a subscription never derives `trial`, regardless of `trial_ends_at`.
- Frontend: remove any create-workspace affordances; workspace switcher remains
  (memberships in others' workspaces).
- Open for step doc: existing users who own multiple workspaces (lean: grandfather
  them, block new creation); signup-trigger vs lazy-bootstrap mechanics.

### Step 3 — Trial + extension flow
*Doc: `workspace-billing-revamp-step-3.md` — created when the step starts.*

**Goal:** 7-day workspace trial, one self-serve extension with review ask, email
path afterward.

- Server: trial state in entitlements; extension endpoint (+7d from extension
  date, increments count, idempotent); manual-grant path for email requests
  (simplest possible internal mechanism — decide in step doc). Eligibility: the
  one-way door (§3 Trial) — workspaces that are or have ever been pro are refused
  extensions, self-serve and manual alike.
- Frontend: trial banner/countdown; "extend trial" flow; post-grant Chrome Web
  Store review popup (grant first, ask after — never conditional); after count=1,
  the extend CTA becomes "email john@recordio.io". No extend CTA at all for
  ever-pro workspaces.
- Open for step doc: what the trial-end moment looks like in-product (modal? state
  of now-locked features); whether existing share links created during trial keep
  working after it ends (lean: existing links stay live, creating/updating blocked).

### Step 4 — Active-project cap (replaces 14-day expiry)
*Doc: `workspace-billing-revamp-step-4.md` — created when the step starts.*

**Goal:** Remove auto-expiry; enforce N active projects per user per workspace on
free workspaces.

- Server: delete expiry logic in `projectCreateV2.ts`; cap check (count live
  projects by `owner_id` in workspace) at project create + import; grandfathering
  (over-cap = keep all, block new).
- Frontend: import page at-cap state — inline "delete a project or upgrade";
  project-list cap indicator (e.g. "2 of 3 projects") on free workspaces.
- Deferred: extension-side pre-recording cap warning (later fast-follow; server is
  the source of truth regardless).
- Open for step doc: exact N (start 2–3); whether cap warnings appear before the
  cap is hit.

### Step 5 — Sharing & rendering gates + download UX
*Doc: `workspace-billing-revamp-step-5.md` — created when the step starts.*

**Goal:** Share links gated trial/Pro server-side; one-button download; background
export as the Pro perk with contextual upsell.

- Server: `/project-share` + `/mux-video-create` + `/render-job-create` consult
  entitlements (share path: trial/Pro; direct render-for-download: Pro/trial only);
  per-project daily render rate limit.
- Frontend: kill the local/cloud choice in `DownloadModal`; single Download button
  — free: in-browser export with live ETA + threshold-triggered upsell copy;
  Pro/trial: background export with "we'll notify you", instant when cached; Share
  button for free users opens upgrade modal.
- Copy principles (fixed): "background export", tab-freedom framing; never
  "faster", "quality", "local", or "cloud" in-product.
- Open for step doc: ETA threshold for showing the upsell; notification mechanism
  when a background export completes; behavior when a cached render is stale.

### Step 6 — Seats, invitations & checkout
*Doc: `workspace-billing-revamp-step-6.md` — created when the step starts.*

**Goal:** Upgrade-first, invite-driven auto-scaling billing.

- Server: invitations require an active subscription (entitlements `canInvite`);
  on creator/admin invite **acceptance** → Stripe quantity +1 (prorated); on
  member removal or creator→viewer downgrade → quantity −1; viewers bypass
  quantity entirely; hidden viewer ceiling with "contact support" response.
  (`/workspace-seats-set` was already removed in Step 1 — until this step lands,
  admins change seats via `/subscription-change`, which does Stripe + DB.)
- Frontend: invite flow shows the billing delta ("adds $X/mo, prorated $Y today");
  workspace settings shows seat count + per-seat price; viewer-limit notice.
- Open for step doc: race/failure handling between invite acceptance and Stripe
  update; exact viewer ceiling number; whether admins get an email/receipt on
  seat changes.

### Step 7 — Lapse handling & member lifecycle
*Doc: `workspace-billing-revamp-step-7.md` — created when the step starts.*

**Goal:** Well-defined downgrade state machine + the removal/downgrade
transfer-or-delete flow.

- Server: on terminal lapse/cancel — block invites, revoke pending invitations,
  re-apply free entitlements (cap grandfathered, feature locks); `past_due` =
  full access + dunning window. Member remove/downgrade routes extended with the
  transfer-to-self / transfer-to-other / delete (soft-delete) choice.
- Frontend: lapsed-workspace banners; removal/downgrade dialog with the ownership
  choice; revoked-invitation states.
- Open for step doc: do existing members of a lapsed workspace keep edit rights
  indefinitely, or eventually drop to viewers? (Current decision: keep roles; only
  invites are cut. Revisit if lapsed multi-editor workspaces become a free-collab
  loophole.) Also: recovery-window length for soft-deleted projects.

### Step 8 — Migration & cleanup
*Doc: `workspace-billing-revamp-step-8.md` — created when the step starts.*

**Goal:** Move existing data/users onto the new model and delete dead code.

- Existing `teams` subscriptions → seats model on the single plan; existing `pro`
  → `seats = 1`; Stripe price/quantity migration.
- Existing `user_profiles.trial_ends_at` → workspace trial; decide fresh-trial
  policy for existing workspaces at rollout.
- Multi-workspace owners → grandfather policy from Step 2.
- Remove: expiry job/logic remnants, `plan` column, seats-set route, stale "Pro
  subscription" comments, `is_personal` (or mark deprecated).
- Open for step doc: rollout order/flags so client and server gates flip together.

## 6. Step log

- **Step 1 — completed 2026-09-01** ([`workspace-billing-revamp-step-1.md`](workspace-billing-revamp-step-1.md)).
  Verified: full server suite green (incl. real-Postgres e2e tier), webapp + extension
  typecheck and build. Design changes made during implementation (propagated above):
  - `/workspace-seats-set` removed in Step 1 rather than Step 6 — it wrote seats to the
    DB without touching Stripe, a billing-integrity hole once seats mean billed
    quantity. Seat changes go through `/subscription-change` until Step 6's
    auto-scaling; the seat stepper lives on the BillingPage.
  - `/subscription-get` non-members now get 403 (previously `null`, indistinguishable
    from no-subscription) — an entitlements payload can't be information-hidden.
    Unresolvable workspace → 404. MembersPage's "set up team access" seat panel was
    deleted outright (only reachable when `seats` was NULL, impossible now).
  - The live seats constraint was named `subscriptions_seats_teams_only` (renamed from
    `_business_only` by migration `20260513121811`); the Step 1 migration
    (`20260901095520_subscription_single_plan.sql`) drops both names.
  - `/transcribe` now allows `past_due` (dunning = full access) and product-trial
    workspaces — both previously 403; this also fixed the client-side drift where
    CaptionsSettings excluded trial users.

- **Step 2 — completed 2026-09-01** ([`workspace-billing-revamp-step-2.md`](workspace-billing-revamp-step-2.md)).
  Verified: 471 server tests green (new signup-bootstrap trigger suite, one-way-door
  derivation, owner-invite guards), webapp + extension typecheck and dev builds;
  migration + trigger applied and smoke-tested against the local DB. Design changes
  made during planning/implementation (propagated above):
  - **Owner membership implicit** (decided during step planning): owners lose their
    `workspace_members` rows; `isWorkspaceAdmin`/`isWorkspaceMember` gained the
    owner override; member listings/workspace list synthesize the owner; seat floor
    in `/subscription-change` became `member rows + 1`; inviting the owner's email
    is now explicitly rejected (invite + accept guards).
  - Gap-cohort backfill (decided 2026-09-01): NULL-profile-trial workspaces got
    `trial_ends_at = migration time` ("ends today", extension count 0) — Step 3's
    self-serve extension doubles as their on-demand trial grant.
  - The signup trigger was renamed `user_profile_create` → `user_signup_bootstrap`
    and ships via `sql/deploy.sh` (+ graveyard), not the migration — supabase
    conventions keep migrations schema-only. Deploy prod migration + `sql/deploy.sh
    --remote` together, then server → webapp.
  - `AuthManager.fetchProfile()` deleted (only synced the profile trial);
    `/user-profile-get` keeps returning `{ name }` with no current webapp caller.

## 7. Global open knobs (tuning, not blockers)

- Free cap N (start 2–3 active projects).
- Hidden viewer ceiling (~50–100).
- Render rate limits (per project per day).
- Trial-end behavior for existing share links (lean: stay live).
- ETA threshold for the download upsell.
- Soft-delete recovery window.

## 8. Explicitly out of scope / rejected

- Watermarks on exported video — rejected, not to be reintroduced.
- Branded/unbranded badge feature on the share page — rejected pre-launch (the
  watch page itself is branded; that's sufficient).
- Extension-side cap pre-check — deferred (slow ship cycle); server enforcement
  + import-page UX cover it.
- Workspace ownership transfer / workspace deletion — not needed under the
  one-workspace-per-account model; revisit post-launch for real orgs.
- Visible viewer-seat math (`seats * 10`) or viewer billing UI.
