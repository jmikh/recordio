# Admin Project Access

## Context
You want the ability to load any user's project in the browser by navigating to `/editor?projectId=xxx` with any project ID. Currently, two ownership checks block this:
1. **DB function `project_get`** filters by `user_id = auth.uid()`
2. **Edge function `storage-download-urls`** verifies storage paths start with the caller's `user.id/`

## Approach
Use a hardcoded admin UID list (env var pattern matching `VITE_DEV_PRO_UID`). Admin users get an `isAdmin` flag in the user store, and the backend provides admin-specific endpoints that skip ownership checks.

## Changes

### 1. New env var `VITE_ADMIN_UIDS`
- **File:** `webapp/.env` (and `.env.development.local`)
- Add `VITE_ADMIN_UIDS=<your-uid>` (comma-separated for multiple)

### 2. User store — add `isAdmin`
- **File:** `webapp/src/editor/stores/useUserStore.ts`
- Add `VITE_ADMIN_UIDS` env var parsing (split by comma)
- Add `isAdmin: boolean` to state
- Derive it in `setUser` and `onRehydrateStorage` (same pattern as `DEV_PRO_UID`)

### 3. New DB function `admin_project_get`
- **File:** `supabase/sql/functions/admin_project_get.sql`
- Same as `project_get` but:
  - Checks `auth.uid()` is in a hardcoded admin UUID list (or reads from vault)
  - Skips the `user_id = auth.uid()` filter
  - Still bumps `last_accessed_at` and excludes deleted projects

### 4. Frontend — use admin RPC when admin
- **File:** `webapp/src/storage/cloudStorage.ts`
- Add `loadProjectMetadataAsAdmin(projectId)` method that calls `admin_project_get`
- **File:** `webapp/src/storage/cloudProjectService.ts`
- In `loadProject`, if normal load returns null and user is admin, retry with admin method

### 5. Edge function — admin bypass for storage downloads
- **File:** `supabase/functions/storage-download-urls/index.ts`
- After getting authenticated user, check if `user.id` is in an admin list (env var `ADMIN_UIDS`)
- If admin, skip the `path.startsWith(user.id/)` ownership check

### 6. Edge function env var
- Add `ADMIN_UIDS` to the edge function's environment (`.env` or Supabase secrets)

## Files to modify
1. `webapp/.env` — add `VITE_ADMIN_UIDS`
2. `webapp/src/editor/stores/useUserStore.ts` — add `isAdmin` derivation
3. `supabase/sql/functions/admin_project_get.sql` — new file
4. `webapp/src/storage/cloudStorage.ts` — add `loadProjectMetadataAsAdmin`
5. `webapp/src/storage/cloudProjectService.ts` — fallback to admin load
6. `supabase/functions/storage-download-urls/index.ts` — admin bypass

## Verification
1. Set your UID in `VITE_ADMIN_UIDS`
2. Deploy `admin_project_get` via `sql/deploy.sh`
3. Set `ADMIN_UIDS` in edge function env
4. Navigate to `/editor?projectId=<someone-elses-project-id>`
5. Project metadata should load, media should download via signed URLs
