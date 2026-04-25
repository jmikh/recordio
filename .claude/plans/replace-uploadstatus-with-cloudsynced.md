# Replace `uploadStatus` with `cloudSynced` boolean

## Context

`uploadStatus` (`'pending' | 'ready'`) is a string field tracking whether media is uploaded to cloud. It's effectively a boolean. Replace with `cloudSynced: boolean` (null/undefined = false). Since the cloud query will only return ready projects, we don't need to read `upload_status` from the cloud at all — cloud projects are ready by definition.

## Changes

### 1. `cloudStorage.ts` — filter cloud query for ready only
- Add `.eq('upload_status', 'ready')` to `listProjectsSummary()` query (line 169)
- Remove `upload_status` from the select columns and `CloudProjectSummary` interface (line 16)
- Keep `upload_status` on `CloudProject` (used by `getProject`) and on the upsert in `saveProjectMetadata` — those are write-side / full-row reads

### 2. `projectStorage.ts` — rename field in SyncMeta
- `uploadStatus: 'pending' | 'ready'` → `cloudSynced: boolean` (line 46-47)

### 3. `syncService.ts` — bulk changes
- **ProjectListItem** (line 19): `uploadStatus: string | null` → `cloudSynced: boolean`
- **listProjects cloud mapping** (line 238): remove `uploadStatus: cloud.upload_status` → `cloudSynced: true` (cloud projects are always ready since we filtered the query)
- **localToListItem** (line 645): `uploadStatus: null` → `cloudSynced: false`
- **syncProjectToCloud / pushProject** (line 142): `uploadStatus: syncMeta?.uploadStatus ?? 'pending'` → `cloudSynced: false`
- **onProjectCreated** (line 305): `uploadStatus: 'pending'` → `cloudSynced: false`
- **resolveConflictReload** (line 385): → `cloudSynced: false`
- **resolveConflictForce** (line 418): → `cloudSynced: false`
- **uploadProjectMedia success** (line 492): `uploadStatus: 'ready'` → `cloudSynced: true`
- **resumePendingUploads** (line 507): `m.uploadStatus === 'pending'` → `!m.cloudSynced`
- **resumePendingUploads error case**: if `!m.cloudSynced` and no local blobs exist to upload → Sentry error + delete the syncMeta for that project

### 4. `App.tsx` (editor)
- Line 206: `uploadStatus: cloudProject.upload_status === 'ready' ? 'ready' : 'pending'` → `cloudSynced: cloudProject.upload_status === 'ready'`
- Line 236: `uploadStatus: syncMeta?.uploadStatus ?? 'ready'` → `cloudSynced: true` (pulling from cloud = already synced)

### 5. `DashboardPage.tsx`
- Line 155: `p.uploadStatus === 'ready' || p.hasLocal` → `p.cloudSynced || p.hasLocal`

### 6. `storageCleanup.ts`
- Line 99: `m.uploadStatus === 'ready'` → `m.cloudSynced`

## NOT changed
- `cloudStorage.ts` upsert still writes `upload_status: 'pending'` (cloud DB schema unchanged)
- `CloudProject` interface keeps `upload_status` (used by editor for full project loads)
- Edge function `storage-confirm-media` unchanged (server-side)
- No IndexedDB migration — old records without `cloudSynced` are falsy, idempotent re-upload handles it

## Verification
- `npm run build` — TypeScript catches any missed `uploadStatus` references
- Test: record new project → `cloudSynced` starts false → media uploads → becomes true
- Test: dashboard shows local + cloud-synced projects, hides broken cloud-only ones
- Test: `resumePendingUploads` handles orphaned syncMeta (no local blobs) by logging Sentry + deleting
