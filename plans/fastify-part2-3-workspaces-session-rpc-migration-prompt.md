# Prompt: Part 2 Batches 3+4 — workspace + session/identity routes (inline SQL ports)

Read FIRST, in order: `plans/fastify-part2-rpc-proxy-migration.md` (the
design — inline ports, regular routes, hard cutover, DoD),
`plans/fastify-part2-2-projects-rpc-migration-prompt.md` (the executed
Batch 2 — its status records the conventions this batch reuses),
`plans/shared-api-contract.md` (Step 1 landed — these routes are BORN
TYPED, see contract obligations below), and the agent instructions at
the top of `plans/suggested_changes.md`.

## Context (as of 2026-07-25)

- Batches 1–2 are live and committed; the shared contract Step 1 landed:
  `shared/api/` holds TypeBox schemas + the `ApiRoutes` map, the server
  imports them as `@shared/api/*` (tsconfig paths + tsup alias +
  vitest aliases — all configured, nothing to add), and `invokeFunction`
  is typed against the map.
- Same approach as Batch 2: each SQL fn becomes a regular route —
  kebab-case top-level path, one camelCase module in
  `server/src/routes/`, inline SQL over `app.deps.db` with the verified
  `req.user.id` as an explicit bind param. Client call sites swap from
  `supabase.rpc(...)` to `invokeFunction(name, body)` in the SAME
  change. Rollback = git revert. SQL fns stay deployed and FROZEN.
- Batches 3 and 4 ship as ONE batch (user decision 2026-07-25) — these
  are the LAST client RPCs; after this batch `.rpc(` disappears from
  webapp/src and the graveyard sweep can be planned.

## Contract obligations (new since Batch 2)

- Request/response schemas go in `shared/api/workspaces.ts` and
  `shared/api/session.ts` (new files, same conventions as
  `shared/api/projects.ts`): TypeBox schemas + `Static<>` types for
  everything the server validates; PLAIN interfaces for jsonb-blob
  responses the server deliberately doesn't schema-validate. Extend
  `ApiRoutes` in `shared/api/index.ts` with every new route.
- Client call sites use bare `invokeFunction('workspace-get', {...})` —
  no inline generics anywhere. If a call site needs a type annotation,
  the contract is wrong; fix the contract.
- Response-shape rule (Batch 2 precedent): camelCase client-shaped
  objects for small/scalar responses; keep the jsonb field shape
  (snake_case) for blob responses the client already consumes
  (workspace-get, workspace-list, workspace-get-default,
  subscription-get, user-profile-get). Audit each call site for exactly
  which fields it reads and pin those.

## Scope: 14 SQL fns → 14 routes

Batch 3 — workspaces (11):

| SQL fn | route | notes |
|---|---|---|
| `workspace_create(p_name)` jsonb | `/workspace-create` | also inserts admin member + sets caller's default_workspace_id |
| `workspace_get(p_workspace_id)` jsonb | `/workspace-get` | big blob: members, pending invitations, seats, viewer_seats (= seats×10), caller role. See LIVE BUG below |
| `workspace_list()` jsonb | `/workspace-list` | member of, oldest-first. Orders by TEXT rendering of created_at — fix on live path (ORDER BY the columns), same class as project_list (log it) |
| `workspace_rename(p_workspace_id, p_name)` jsonb | `/workspace-rename` | admin |
| `workspace_set_default(p_workspace_id)` void | `/workspace-set-default` | viewer (member); client fires-and-forgets |
| `workspace_invite(p_workspace_id, p_email, p_role)` jsonb | `/workspace-invite` | admin; delete-then-insert re-invite; lower(email); role enum via schema; EMAIL — see below |
| `workspace_invite_accept(p_token)` jsonb | `/workspace-invite-accept` | token+pending lookup; EMAIL MATCH against the caller's token email; upsert member; mark accepted; set default workspace |
| `workspace_invite_rescind(p_invitation_id)` jsonb | `/workspace-invite-rescind` | admin of the invitation's workspace; pending only |
| `workspace_member_remove(p_workspace_id, p_user_id)` jsonb | `/workspace-member-remove` | admin; owner unremovable; transfers member's projects to CALLER + strips project_editors rows; returns transferred_count |
| `workspace_member_update_role(...)` void | `/workspace-member-update-role` | admin; owner's role locked; role enum via schema |
| `workspace_seats_set(p_workspace_id, p_seats)` jsonb | `/workspace-seats-set` | admin; seats ≥ 1 via schema; errors if no subscription row |

Batch 4 — session/identity (3):

| SQL fn | route | notes |
|---|---|---|
| `user_profile_get()` jsonb | `/user-profile-get` | `{ name, trial_ends_at }`, null-ish if no profile |
| `workspace_get_default()` jsonb | `/workspace-get-default` | THE session bootstrap: stored default → validate → oldest owned → CREATE 'My Workspace' + admin member → heal default_workspace_id → return blob with role + seats. Port the whole heal chain |
| `subscription_get(p_workspace_id?)` jsonb | `/subscription-get` | member-gated via JOIN; workspaceId OPTIONAL (falls back to oldest owned workspace); no subscription → null (client handles); Ajv gotcha: optional key, never nullable |

Decisions already made (do NOT re-litigate):

- **`trial_start` is KILLED** (user decision 2026-07-25): no route, no
  caller existed. Dies with it: the ability to start trials (new users
  keep trial_ends_at NULL; existing dates still honored wherever read)
  and the last CLEARER of projects.expires_at (suggested_changes
  bullet updated). Add the fn to the graveyard sweep list.
- **`/send-welcome-email` route STAYS** (user decision) even though
  trial_start's pg_net post was its only caller — it's caller-less
  after the sweep, kept for future re-wiring. Note this in its header
  comment (its "called by trial_start" comment becomes stale — update).
- **`workspace_delete` gets no route**: zero callers anywhere (checked
  webapp/extension/server 2026-07-25). Graveyard-candidate — list it in
  suggested_changes, user confirms at the sweep.
- **`user_profile_create` is out of scope**: it's the auth.users INSERT
  trigger (signup bootstrap), not a client RPC. It stays.

## LIVE BUG to fix on the port (found scoping this batch)

`workspace_get`'s invitations list filters `wi.expires_at > now()`, but
migration `20260513042717_workspace_invitations_no_expiry.sql` made
expires_at NULL for all pending invitations (invites no longer expire) —
`NULL > now()` is NULL, so the pending-invitations list is ALWAYS EMPTY
today, and MembersPage's seat floor under-counts (it sums members +
pending invitations). Port WITHOUT the expires_at predicate (keep
`status = 'pending'`), drop `expires_at` from the invitation row shape
(nothing can read a value that was never delivered — verify in the call
-site audit), and pin with a test: pending invitation with NULL
expires_at APPEARS. Already logged in suggested_changes; the frozen SQL
fn keeps the bug until the sweep.

## Porting rules (per fn, in order)

1. Read the SQL source (`supabase/sql/functions/<fn>.sql`) — access
   rule, NULL semantics, exact return shape, side effects, RAISEs.
2. Access checks: `isWorkspaceMember` (services/projectAccess.ts)
   already matches assert_workspace_viewer (member + live workspace).
   Add `isWorkspaceAdmin` beside it (member + role='admin' + live
   workspace, assert_workspace_admin parity). Don't force reuse where
   semantics differ.
3. RAISE → HTTP: PT403-style asserts → 403 `{ error }`; business
   RAISEs whose message a call site DISPLAYS (audit! e.g.
   AcceptInvitePage shows invite errors like "This invitation was sent
   to a different email address") → 4xx with the EXACT message in a
   typed body; RAISEs nothing reads → Fastify defaults. Enum checks
   (`p_role NOT IN (...)`, `p_seats < 1`) become schema constraints —
   a 400 replaces the old RPC error; verify no call site matches on
   those specific messages.
4. `auth.email()` (invite_accept) — the verified JWT carries the email
   claim; read it from `req.user` (check what the auth plugin exposes;
   extend it if it only surfaces `id`) rather than querying auth.users.
5. **workspace_invite's email**: the SQL fn fires pg_net →
   `/send-workspace-invite-email`. The route port sends the email
   IN-PROCESS instead: extract the send logic from
   `routes/sendWorkspaceInviteEmail.ts` into a service both use
   (route kept — the frozen SQL fn still posts to it until the sweep).
   Fire-and-forget with a logged failure (pg_net parity: invite
   creation must succeed even if the email fails).
6. Prefer single statements; multi-write fns (create, invite_accept,
   member_remove, get_default's heal chain) need their writes to stay
   coherent — use a transaction if the pool helper supports it, else
   sequence them in the SQL-fn order and document the non-atomic gap in
   the route comment (Batch 2 precedent: ported side effects keep their
   order).
7. One route module + one test file per route, registered flat in
   app.ts under the Part 2 comment.

## Load-bearing parity points (each gets a pinning test)

1. **workspace_get_default heal chain** — AuthManager calls it on
   every login; the create-if-none branch is how brand-new users get a
   workspace at all. Pin: stale stored default (deleted workspace) →
   falls back + heals the profile row; no workspace at all → creates
   'My Workspace' + admin membership + returns it.
2. **subscription_get omitted workspaceId** — falls back to oldest
   OWNED workspace; and no-subscription → null response body (client:
   AuthManager, BillingPage, switchWorkspace all branch on null).
   Optional integer/uuid keys follow the Ajv rule: `Type.Optional`,
   client omits the key (never sends null).
3. **workspace_invite_accept email mismatch** — exact error string
   surfaces in AcceptInvitePage; pin 4xx body. Also pin: accepting
   twice → "Invitation not found or already used" path; role UPSERT on
   re-invite of an existing member.
4. **workspace_member_remove transfer** — member's projects repoint to
   the CALLER (not the owner), project_editors rows stripped, count
   returned; owner removal → error. Pin all three.
5. **The invitations LIVE BUG pin** (above).
6. **workspace_list ordering** — oldest-first survives (by column, not
   text); the switcher relies on "original workspace first".
7. **Fire-and-forget invite email** — email service throwing must NOT
   fail /workspace-invite (fake email dep that throws; route 200s,
   failure logged).

## Batch 4 consolidation (after the 3 session routes land)

Part 1 routes inline-copied subscription/entitlement lookups:
`projectCreateV2.ts` (expiry entitlement) and `transcribe.ts`
(active|trialing gate). Extract a `services/subscriptions.ts` ONLY
where semantics MATCH the new /subscription-get port exactly (verify
per copy — the statuses they accept differ, see the
subscription-status-inconsistency bullet in suggested_changes; do NOT
unify the policies, just the query plumbing if it's genuinely shared).
If they don't match, log it and leave them.

## Tests + client mechanics

- Per-route test files, Part 1/2 conventions: 401 + schema-400
  pre-query via throwing db; e2e on real Postgres (`describe.runIf
  (hasTestDb())`); DB-state assertions for every mutating fn; canonical
  log fields (`workspace.id`, `user.id`). Helpers: seedWorkspace/
  deleteWorkspaces exist; add workspace_members / workspace_invitations
  / subscriptions seeders + targeted deletes as needed. Unique ids +
  containment assertions where seeded users are contested by parallel
  suites; projects delete BEFORE workspaces (FK NO ACTION).
- Client swaps: AuthManager (user_profile_get, workspace_get_default,
  subscription_get), switchWorkspace (workspace_set_default
  fire-and-forget + subscription_get), DashboardPage (workspace_list,
  workspace_create), WorkspaceSettingsPage (workspace_get,
  workspace_list), MembersPage (invite ×2, rescind, member_remove,
  member_update_role, seats_set), GeneralPage (workspace_rename),
  AcceptInvitePage (workspace_invite_accept), ImportPage
  (workspace_get_default). Re-grep `\.rpc\('` before starting — after
  this batch the ONLY remaining supabase client uses should be auth +
  TUS storage; state what's left in the status.
- Request bodies camelCase (`workspaceId`, not `p_workspace_id`).
- Out-of-scope finds → `plans/suggested_changes.md`, never fixed inline.

## Checks + gate (do not skip)

- Root `npx vitest run server webapp/src` — only acceptable failure is
  the known pre-existing cloudProjectService expectation.
- `server`: `npm run typecheck` + `npm run build` (tsup must bundle the
  new shared/api files); `webapp`: `tsc -b`; eslint on changed files
  (verify any finding on HEAD before dismissing).
- Local HTTP smoke against a throwaway instance (Batch 2 pattern:
  `PORT=8085 npx tsx --env-file=.env.local src/server.ts`, kill after;
  8080 is the user's dev server, 8090 the render worker): at least
  workspace-get-default (heal), workspace-list, workspace-create,
  subscription-get (null case), invite → workspace-get shows it
  pending → rescind. Clean up seeded rows.
- Then STOP: user browser click-through (login/session bootstrap,
  workspace switcher, settings tabs incl. members + pending
  invitations now actually listing, invite/accept with a second
  account if feasible, billing tab), go-ahead; commit/push + prod
  deploy timing is the user's. First prod deploy after this must
  verify the Railway build-context note (suggested_changes). Update
  the status sections of the parent doc and this file, then plan the
  graveyard sweep.

## Status

- 2026-07-25 — prompt written (Batches 3+4 merged, user decision).
- 2026-07-25 — **CODE COMPLETE + HTTP-smoke-tested.** All 14 routes
  landed per this prompt, born typed (`shared/api/workspaces.ts` +
  `session.ts`, 15 new ApiRoutes entries, zero inline generics at any
  call site). Notables:
  - `isWorkspaceAdmin` added beside `isWorkspaceMember`
    (services/projectAccess.ts); the invite email extracted into
    `services/workspaceInviteEmail.ts`, shared by the (kept)
    /send-workspace-invite-email route and /workspace-invite's
    in-process fire-and-forget send. The auth plugin already exposed
    `req.user.email` — no change needed for invite-accept.
  - The invitations LIVE-BUG fix shipped as planned: /workspace-get
    filters on status only; pinned by test AND observed live in the
    smoke test (pending invite listed). `expires_at` dropped from the
    wire + webapp type (nothing read it).
  - Business-error-in-200-body only where a message is displayed:
    /workspace-invite-accept (both exact SQL messages pinned).
    Owner-guard RAISEs → 409s; not-found → 404s (unread, generic
    toasts).
  - subscription consolidation: NOT done, deliberately — the two Part 1
    inline reads are one-liners with different policies
    (active|past_due vs active|trialing); documented in
    subscriptionGet.ts's header.
  - Test infra: `seedAuthUser`/`deleteAuthUsers` (mirror seed.sql —
    dedicated per-suite auth users kill contention over
    default_workspace_id/profile rows and make the
    workspace-get-default BOOTSTRAP branch directly testable),
    `seedWorkspaceInvitation`, `getDefaultWorkspaceId`.
  - Client: 9 files swapped; `pages/settings/types.ts` now re-exports
    the shared contract types; supabase import died in 7 of the files.
    `subscription-get` callers OMIT workspaceId (never null — Ajv
    string coercion, pinned 400). Store's narrower status union kept
    via one boundary cast (wire status is Stripe's string).
  - Checks: 70 new tests, full suite 502 passed + the known
    pre-existing failure; both typechecks, tsup build, eslint (zero
    new findings) clean. Smoke test (throwaway 8085, real ES256
    token): get-default, list, profile, subscription null-fallback,
    create → invite → get-shows-pending → rescind → rename →
    set-default restore; the invite email leg hit a REAL Resend 422
    (example.com recipient) and the invite still succeeded with the
    warn logged — fire-and-forget parity observed live. Rows cleaned
    up (plus 3 leftover test workspaces from older interrupted runs).
  - `grep -rn "\.rpc(" webapp/src` → **0**. supabase-js remains for
    auth/session tokens + TUS uploads only — Part 2's exit criteria.
- **Remaining (user):** restart the 8080 dev server, browser
  click-through (login bootstrap, switcher, settings tabs — pending
  invitations now actually list, invite/accept flow, billing), then
  commit/push + prod deploy (verify the Railway build-context note at
  that deploy). After go-ahead: plan the graveyard sweep.
