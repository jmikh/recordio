# Admin user impersonation (oneshot)

**Created:** 2026-09-04
**Goal:** Let an admin (currently just John) use recordio.io as any user — their dashboard, projects, editor, and produced videos — to inspect their experience.

## Decisions (confirmed)

- **Full read-write** impersonation: the admin acts exactly as the user, edits included. Mitigated by a persistent banner, short token expiry, and audit logging — not by blocking writes.
- **Admin gating via env allowlist**: required `ADMIN_EMAILS` env var on the server. No `is_admin` column, no migration.
- **Entry point**: hidden `/admin` page in the webapp with user search + Impersonate button.
- **Webapp-only**: the Chrome extension (recording new videos as the user) is out of scope.

## Why this design works

Verified during research:

- Every data path goes through the Fastify server. There are **zero** direct `supabase.from()` / `supabase.storage` / `.rpc()` calls in `webapp/`, `shared/`, or `extension/` — the Supabase JS client is used for auth/session only. So a token our server trusts covers 100% of data access (projects, signed storage URLs, Mux playback, editor saves).
- `server/src/plugins/auth.ts` verifies HS256 tokens with `SUPABASE_JWT_SECRET` (auth.ts:75-77) and accepts any token with a valid signature, `sub`, and `role: 'authenticated'` (auth.ts:86). A server-minted token with `sub = targetUserId` is indistinguishable from a real session to every existing route — **no per-route changes needed**.
- `webapp/src/api/client.ts` attaches whatever bearer token it's told to (client.ts:45-48). Swapping the token swaps the identity for all API calls.
- Anyone holding `SUPABASE_JWT_SECRET` can already mint arbitrary user tokens, so this feature adds no new secret-compromise surface.

## Architecture

```
/admin page ──(admin JWT)──▶ POST /admin-user-list     ─▶ users, recent-activity first
             (combobox: recent users on open, fuzzy filter as you type)
             ──(admin JWT)──▶ POST /admin-impersonate  ─▶ mint HS256 JWT:
                                                           sub = target user
                                                           role = 'authenticated'
                                                           impersonated_by = admin id
                                                           exp = 1h
sessionStorage ◀── { token, target, expiresAt }
     │
     └─▶ invokeFunction prefers impersonation token ──▶ every existing route
         AuthManager overrides identity stores          behaves as the target user
         Banner: "Viewing as {email} — Exit"
```

### Server

**1. Config — `server/src/config.ts`**
Add `ADMIN_EMAILS: Type.String({ minLength: 1 })` (comma-separated, compared case-insensitively). Required, per convention — a deploy without it should fail loudly. Update `server/.env.example` and local env.

**2. Admin routes — new `server/src/routes/admin/`**
Follow the existing route-plugin pattern (config passed into the plugin factory like `stripeCheckoutRoutes`; register in `server/src/app.ts`). Shared `requireAdmin` preHandler: runs after `app.requireUser`, 403 unless `req.user.email` is in the allowlist.

- `POST /admin-user-list` — empty body. Returns users **sorted by most recent activity first**: `ORDER BY GREATEST(u.last_sign_in_at, latest project updated_at) DESC NULLS LAST` over `auth.users` joined with `user_profiles` and a projects aggregate (server has direct Postgres access via `DATABASE_URL`). Fields: id, email, name, created_at, last_active_at, project count. Cap at ~500 rows — fuzzy filtering happens client-side (below), so one fetch on page load serves the whole session; no per-keystroke queries, no pg_trgm migration. If the user base outgrows the cap, a follow-up can add a server-side `query` param. Also serves as the UI's "am I admin" probe (403 → not authorized).
- `POST /admin-impersonate` — body `{ userId }`. Looks up the target, mints an HS256 JWT with jose (`SignJWT`, already a dependency) signed with `SUPABASE_JWT_SECRET`:
  - `sub`, `email`, `user_metadata` (target's), `role: 'authenticated'`, `aud: 'authenticated'`
  - `impersonated_by: req.user.id` — the audit marker
  - `exp`: 1 hour, no refresh
  - Logs an audit line (admin id/email → target id/email) at info level → Axiom.
  - Response: `{ token, expiresAt, targetUser: { id, email, name } }`.

**3. Auth plugin — `server/src/plugins/auth.ts`**
No change needed for the token to be *accepted*. Additively: read the `impersonated_by` claim into `req` (e.g. `req.impersonatedBy`) and, when present in `requireUser`, log one line per request — a full audit trail of everything done while impersonating, queryable in Axiom.

**4. Shared contract — `shared/api/admin.ts`**
Request/response types for both routes, wired into `ApiRoutes` in `shared/api/index.ts` so `invokeFunction` calls are typed.

### Webapp

**5. Impersonation module — new `webapp/src/auth/impersonation.ts`**
State lives in **sessionStorage** (key `recordio-impersonation`: `{ token, expiresAt, target }`) — tab-scoped, gone on tab close, never touches the admin's real Supabase session.
- `getImpersonation()` — returns state, clears it if expired.
- `startImpersonation(payload)` — write + navigate to `/` + reload.
- `stopImpersonation()` — clear + reload (AuthManager re-syncs the admin's real identity from the untouched Supabase session).

**6. API client — `webapp/src/api/client.ts` (+ `webapp/src/supabase/client.ts`)**
In `invokeFunction` and `invokeFunctionUpload`: if impersonation is active, use its token instead of the Supabase session token. 401 handling: while impersonating, a 401 means the impersonation token expired — call `stopImpersonation()` instead of funneling into `notifyUnauthorized`/sign-out, so the admin's real session survives.

**7. Identity override — `webapp/src/auth/AuthManager.ts`**
After the normal session sync, if impersonation is active, overwrite `useUserStore` identity fields (userId, email, name) with the target's. Workspace/subscription need no special handling — `workspace-get-default` and `subscription-get` already go through `invokeFunction`, which now carries the target's token, so the target's workspace loads naturally.
*Known caveat:* `useUserStore` persists to localStorage, so another tab of the same origin briefly sees the impersonated identity in the store while impersonation is active. Acceptable for a single-admin tool; exiting (or reloading any tab without the sessionStorage key... which is every other tab) re-syncs from the real session.

**8. Admin page — new `webapp/src/pages/admin/AdminPage.tsx`**
Route `/admin` added to the manual router in `webapp/src/App.tsx` (auth-required — not added to `isPublicRoute`). Fetches `admin-user-list` on mount; on 403: "Not authorized." **Load the ui-guidelines skill before building.**

User picker is a **combobox dropdown**:
- On focus/open (empty input): dropdown lists users already sorted most-recently-active first, so the people you likely want to inspect are on top.
- Typing **fuzzily filters** the list client-side with autocomplete — subsequence match over `email` + `name` (e.g. `jsm` matches `john.smith@…`), matched characters highlighted, best matches first (fuzzy score, ties broken by recency). A small pure scoring function in the page module — no new dependency.
- Rows show email, name, last active, project count. Keyboard navigation (↑/↓/Enter) selects; Enter or the Impersonate button → `admin-impersonate` → `startImpersonation`.

**9. Banner — new `webapp/src/components/ImpersonationBanner.tsx`**
Rendered in `App.tsx` whenever impersonation is active, on every page: fixed, visually loud, "Viewing as {email} — full access, changes are real · Exit". Exit → `stopImpersonation()`.

## Security notes

- The minted token works only against our Fastify server; it is never sent to Supabase auth/storage APIs (nothing in the frontend calls them with data tokens — verified).
- 1-hour expiry, no refresh path, sessionStorage-only — closing the tab ends the session.
- `impersonated_by` claim → per-request audit trail in Axiom.
- Full write access is deliberate; the banner is the guardrail. If this ever feels risky, a follow-up can block mutating routes when `req.impersonatedBy` is set — the claim already makes that a small change.

## Implementation order

1. `ADMIN_EMAILS` in config.ts + env files.
2. `shared/api/admin.ts` types + `ApiRoutes` wiring.
3. Server admin routes (`requireAdmin`, user list, impersonate) + registration in app.ts.
4. auth.ts: `impersonated_by` → `req.impersonatedBy` + audit log line.
5. Webapp impersonation module + client.ts token preference + impersonation-aware 401 handling.
6. AuthManager identity override.
7. `/admin` page + banner + App.tsx route (ui-guidelines skill first).
8. Tests + manual verification.

## Testing

- **Integration** (existing harness in `test/`): non-admin → 403 on both admin routes; `admin-user-list` returns seeded users ordered by recent activity; minted token authenticates as the target on `user-profile-get`; expired impersonation token → 401. Unit-test the fuzzy scorer (subsequence match, ranking, recency tiebreak).
- **Manual**: open `/admin`, confirm the dropdown lists recently active users first and fuzzy search narrows them; impersonate a dev-seeded user; confirm dashboard shows their projects, a produced video plays, the editor opens their project; confirm Exit restores the admin identity; confirm the banner is present on every page.

## Out of scope

- Impersonating inside the Chrome extension / recording as the user.
- Read-only enforcement (deliberately full access).
- `is_admin` roles in the DB, multi-admin management UI.
