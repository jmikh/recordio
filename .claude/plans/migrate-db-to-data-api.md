# Plan: Replace Direct DB Calls with Data API (Edge Functions)

## Context
The webapp client uses the Supabase JS client to query tables directly (`.from('projects')`, `.from('subscriptions')`, etc.), which leaks table names, column names, filter logic, and schema structure into the client bundle. This is a security concern — anyone inspecting the JS can see the full DB schema and craft arbitrary PostgREST queries against the exposed tables. Moving to edge-function-based "data API" calls hides the schema behind a server boundary.

## Current State: All Direct DB Calls

### 1. `webapp/src/storage/cloudStorage.ts` — 8 calls (table: `projects`, `user_quotas`)
| Method | Table | Operation | Line |
|---|---|---|---|
| `saveProjectMetadata` (update path) | `projects` | `.update().eq().eq().select()` | 78 |
| `saveProjectMetadata` (upsert path) | `projects` | `.upsert().select()` | 102 |
| `getCloudVersion` | `projects` | `.select('cloud_version').eq().is()` | 131 |
| `loadProjectMetadata` | `projects` | `.select('*').eq().is()` | 148 |
| `listProjectsSummary` | `projects` | `.select(columns).is().eq().order()` | 165 |
| `softDeleteProject` | `projects` | `.update({deleted_at}).eq()` | 182 |
| `updateLastAccessed` | `projects` | `.update({last_accessed_at}).eq()` | 196 |
| `setUploadReady` | `projects` | `.update({upload_status}).eq()` | 375 |
| `getStorageQuota` | `user_quotas` | `.select().eq()` | 221 |
| `getStorageQuota` | RPC | `get_user_storage_bytes` | 216 |

### 2. `webapp/src/storage/userAssetService.ts` — 4 calls (table: `user_assets`)
| Method | Table | Operation | Line |
|---|---|---|---|
| `uploadAsset` | RPC | `confirm_asset_upload` | 72 |
| `listAssets` | `user_assets` | `.select().eq().eq().eq().order()` | 97 |
| `deleteAsset` (read) | `user_assets` | `.select('storage_path').eq()` | 124 |
| `deleteAsset` (update) | `user_assets` | `.update({is_deleted}).eq()` | 130 |

### 3. `webapp/src/editor/services/ShareService.ts` — 4 calls (table: `projects`)
| Method | Table | Operation | Line |
|---|---|---|---|
| `getShareForProject` | `projects` | `.select(cols).eq().not().not().is()` | 68 |
| `deleteSharedVideo` | `projects` | `.select('cf_video_uid').eq().not()` | 209 |
| `renameSharedVideo` | `projects` | `.update({name}).eq()` | 270 |
| `updateSharedVideoMeta` | `projects` | `.update(dbUpdates).eq()` | 325 |

### 4. `webapp/src/auth/AuthManager.ts` — 1 call (table: `subscriptions`)
| Method | Table | Operation | Line |
|---|---|---|---|
| `fetchSubscription` | `subscriptions` | `.select('*').eq().maybeSingle()` | 57 |

### 5. `webapp/src/editor/components/settings/ExportModal.tsx` — 1 call (table: `render_jobs`)
| Method | Table | Operation | Line |
|---|---|---|---|
| poll in `handleServerExport` | `render_jobs` | `.select('status,progress,error').eq()` | 209 |

### 6. `webapp/src/editor/components/header/UpgradeModal.tsx` — 1 call (table: `subscriptions`)
| Method | Table | Operation | Line |
|---|---|---|---|
| poll in `useEffect` | `subscriptions` | `.select(cols).eq().maybeSingle()` | 42 |

---

## Plan: New Edge Functions

Group the calls by domain into new edge functions. Each function accepts a JSON body, performs auth via the JWT, and returns only the data needed.

### Edge Function 1: `data-projects` (replaces 11 `projects` table calls)
**Actions** (dispatched by an `action` field in the body):
- `save` — upsert/update with optimistic concurrency (replaces `saveProjectMetadata`)
- `get-version` — return `cloud_version` for a project (replaces `getCloudVersion`)
- `load` — return full project metadata (replaces `loadProjectMetadata`)
- `list-summary` — return dashboard summaries (replaces `listProjectsSummary`)
- `soft-delete` — set `deleted_at` (replaces `softDeleteProject`)
- `touch` — update `last_accessed_at` (replaces `updateLastAccessed`)
- `set-upload-ready` — flip `upload_status` (replaces `setUploadReady`)
- `get-share` — return share info for a project (replaces `getShareForProject`)
- `get-cf-uid` — return `cf_video_uid` (replaces the select in `deleteSharedVideo`)
- `rename` — update name (replaces `renameSharedVideo`)
- `update-meta` — update name/description (replaces `updateSharedVideoMeta`)

### Edge Function 2: `data-subscription` (replaces 2 `subscriptions` table calls)
**Actions:**
- `get` — return current subscription for the authed user (replaces `fetchSubscription` + UpgradeModal poll)

### Edge Function 3: `data-assets` (replaces 3 `user_assets` table calls + 1 RPC)
**Actions:**
- `list` — list assets by type (replaces `listAssets`)
- `delete` — soft-delete an asset (replaces `deleteAsset` — both the read and update)
- `confirm-upload` — confirm asset upload (replaces `confirm_asset_upload` RPC; could also fold into existing `asset-create` flow)

### Edge Function 4: `data-quota` (replaces `user_quotas` select + RPC)
**Actions:**
- `get` — return `{usedBytes, limitBytes, maxProjects}` (replaces `getStorageQuota`)

### Edge Function 5: `data-render-job` (replaces `render_jobs` poll)
**Actions:**
- `status` — return `{status, progress, error}` for a job ID (replaces the poll in ExportModal)

---

## Client-Side Changes

### `webapp/src/storage/cloudStorage.ts`
- Remove all `.from('projects')` and `.from('user_quotas')` calls
- Remove `.rpc('get_user_storage_bytes')` call
- Replace each method body with `supabase.functions.invoke('data-projects', { body: { action, ...params } })`
- Keep the same public method signatures — callers don't change

### `webapp/src/storage/userAssetService.ts`
- Replace `.from('user_assets')` calls and `.rpc('confirm_asset_upload')` with `supabase.functions.invoke('data-assets', ...)`

### `webapp/src/editor/services/ShareService.ts`
- Replace 4 `.from('projects')` calls with `supabase.functions.invoke('data-projects', ...)`

### `webapp/src/auth/AuthManager.ts`
- Replace `fetchSubscription` body with `supabase.functions.invoke('data-subscription', ...)`

### `webapp/src/editor/components/settings/ExportModal.tsx`
- Replace `render_jobs` poll with `supabase.functions.invoke('data-render-job', ...)`

### `webapp/src/editor/components/header/UpgradeModal.tsx`
- Replace `subscriptions` poll with `supabase.functions.invoke('data-subscription', ...)`

---

## Execution Order

1. **Phase 1** — Create the 5 edge functions (server-side, no client impact)
2. **Phase 2** — Migrate client calls file-by-file, testing each:
   - `cloudStorage.ts` first (biggest surface area)
   - `userAssetService.ts`
   - `ShareService.ts`
   - `AuthManager.ts`
   - `ExportModal.tsx` + `UpgradeModal.tsx`
3. **Phase 3** — Remove RLS policies on `projects`, `user_assets`, `subscriptions`, `user_quotas`, `render_jobs` that allow direct client reads/writes (replace with service-role-only access in edge functions)

## Verification
- Run the app and test: dashboard loads (listProjectsSummary), open a project (loadProjectMetadata), save edits (saveProjectMetadata), delete a project, publish/unpublish, export via server render, subscription status shows correctly, asset upload/list/delete works
- Inspect network tab — no PostgREST `/rest/v1/` calls should remain; all data goes through `/functions/v1/data-*`
- Check client bundle for leaked table names (should find none)
