# Plan: Require Login in Extension Controller, Pass JWT via Bridge

## Context
Currently the extension records without any user identity — the user only logs in on the webapp side (import page) after recording. This creates a disconnect: we can't track recording usage, enforce limits, or tie recordings to users until after the fact. 

This change gates recording behind authentication in the extension controller, then passes the JWT to the webapp via the bridge so the import page auto-authenticates without showing a login modal.

## Changes

### 1. Extension: Supabase auth module
**New file:** `extension/src/shared/auth.ts`

- Create a Supabase client using the same URL/anon key as the webapp (`https://api.recordio.io` + anon key)
- Use a custom storage adapter backed by `chrome.storage.local` so tokens persist across tab closures
- Export helpers: `getSession()`, `signInWithGoogle()`, `signOut()`, `onAuthStateChange()`
- `signInWithGoogle()` uses `chrome.identity.launchWebAuthFlow`:
  1. Build the Supabase OAuth authorize URL with `redirect_to` set to `https://<extension-id>.chromiumapp.org/`
  2. Call `chrome.identity.launchWebAuthFlow({ url, interactive: true })`
  3. Parse `access_token` and `refresh_token` from the redirect URL hash fragment
  4. Call `supabase.auth.setSession({ access_token, refresh_token })`
- Hardcode the Supabase URL and anon key (these are public/client-side values, same as in the webapp)

### 2. Extension: Add `identity` permission
**File:** `extension/manifest.json`
- Add `"identity"` to the permissions array

### 3. Extension Controller: Gate recording on login
**File:** `extension/src/controller/ControllerApp.tsx`
- On mount, check auth state via `getSession()`
- If not logged in, show a login screen with "Sign in with Google" button (similar style to webapp's AuthModal)
- If logged in, show the existing recording setup UI
- Add a small user indicator (email/avatar) + sign out option in the header
- The "Start Recording" button remains gated on `hasSource` as before, but the entire setup UI is behind auth

### 4. Bridge: Add tokens to handoff metadata
**File:** `shared/types/bridge.ts`
- Add `accessToken?: string` and `refreshToken?: string` to `HandoffMetadataResponse`

**File:** `extension/src/background/background.ts`
- In `handleHandoffRequest()`, read the current Supabase session from `chrome.storage.local` and include `accessToken` + `refreshToken` in the response

### 5. Webapp: Auto-authenticate from bridge tokens
**File:** `webapp/src/pages/ImportPage.tsx`
- After receiving handoff metadata, if `accessToken` and `refreshToken` are present and user is not already logged in, call `supabase.auth.setSession({ access_token, refresh_token })`
- This sets the user session automatically — no auth modal needed
- Keep the existing auth modal as fallback (in case tokens are missing/expired)

**File:** `webapp/src/hooks/useExtensionBridge.ts`
- Pass through the new `accessToken`/`refreshToken` fields from the handoff response to the bridge state

### 6. Supabase config: Whitelist redirect URL
- The extension's OAuth redirect URL (`https://<extension-id>.chromiumapp.org/`) must be added to Supabase's allowed redirect URLs in the dashboard. This is a manual config step, not a code change.

## Files to modify
1. `extension/manifest.json` — add `identity` permission
2. `extension/src/shared/auth.ts` — **new** — Supabase client + OAuth helpers
3. `extension/src/controller/ControllerApp.tsx` — auth gate + login UI
4. `shared/types/bridge.ts` — add token fields to HandoffMetadataResponse
5. `extension/src/background/background.ts` — include tokens in handoff response
6. `webapp/src/pages/ImportPage.tsx` — auto-set session from tokens
7. `webapp/src/hooks/useExtensionBridge.ts` — pass through token fields

## Verification
1. Build extension with `npm run build:extension:dev`
2. Load unpacked extension in Chrome
3. Open controller → should see login screen, not recording setup
4. Click "Sign in with Google" → OAuth popup → login → controller shows recording setup
5. Close and reopen controller → should still be logged in (persisted)
6. Record a video → stop → import page opens
7. Import page should auto-authenticate (no auth modal) and proceed to upload
8. Verify the user in the import page matches the extension user
