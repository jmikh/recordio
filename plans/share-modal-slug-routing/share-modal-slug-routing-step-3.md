# Step 3 — sharedVideoGet enforcement + VideoPage auth UX

## Server

- `server/src/plugins/auth.ts`: extract `requireUser`'s JWT verification into an internal `verifyUser(req) → AuthUser | null`; add `optionalUser` decorator (sets `req.user`/`req.userId` when a valid token is present; never 401s). `requireUser` behavior unchanged.
- `server/src/routes/sharedVideoGet.ts`: `preHandler: app.optionalUser`. Ladder replaces the `share_policy !== 'public'` 404:
  - `public` → anyone.
  - otherwise: anonymous → `403 { error: 'auth_required' }` (slug existence leak accepted — slugs are high-entropy and the sign-in UX needs the distinction); signed-in → `canViewProject` (owner, any project_editors row, or workspace member when policy 'workspace'); no access → existing `404 { error: 'not_found' }`.
  - Add 403 to the response schema; keep the 60/min rate limit; header comment updated (optional auth now).

## Webapp

- `webapp/src/pages/VideoPage.tsx`: distinguish the 403 `auth_required` response → "Sign in to view this video" state with `AuthModal`; re-fetch on auth state change (already-signed-in users get their token attached by `invokeFunction` automatically).

## Tests (`server/test/sharedVideoGet.test.ts`)

Matrix: public × {anon, token} unchanged; workspace × {anon 403, owner 200, member 200, editor-view 200, non-member 404}; private × {anon 403, owner 200, editor 200, member-without-grant 404}.
