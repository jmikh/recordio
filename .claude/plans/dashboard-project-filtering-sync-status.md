# Dashboard: Project Filtering by Blob Availability + Sync Status Icons

## Context

When a user creates a project on Machine A, cloud metadata is saved immediately (`upload_status: 'pending'`) while media blobs upload in the background. If the user logs in on Machine B, they see the project but can't open it — the blobs aren't in cloud yet and don't exist locally on Machine B.

**Goal**: Only show projects that are actually usable. Show a live sync status icon on project cards so users know what's happening with their uploads.

**Rule**: A project is shown if its media is **cloud-ready** OR its **blobs exist locally in IndexedDB**.

---

## Files to Modify

| File | Purpose |
|------|---------|
| `webapp/src/storage/syncService.ts` | Add `hasLocalBlobs` field, batch blob-key check, return `cloudFetchFailed` flag |
| `webapp/src/storage/syncStatusStore.ts` | Add per-project `failedUploads` tracking |
| `webapp/src/pages/DashboardPage.tsx` | Updated filter logic, wire sync status to cards |
| `webapp/src/components/ProjectCard.tsx` | New `syncStatus` prop, render status icons |

---

## Step 1: Add `hasLocalBlobs` to `ProjectListItem` and update `listProjects()`

**File: `webapp/src/storage/syncService.ts`**

### 1a. Add field to `ProjectListItem` (line ~27)
```ts
/** Whether the screen recording blob exists locally (proxy for all media being local) */
hasLocalBlobs: boolean;
```

### 1b. Add return wrapper type
```ts
export interface ProjectListResult {
    projects: ProjectListItem[];
    cloudFetchFailed: boolean;
}
```
Change `listProjects()` return type from `Promise<ProjectListItem[]>` to `Promise<ProjectListResult>`.

### 1c. Batch blob-key check inside `listProjects()`

After building the `result` array but before returning, use `ProjectStorage.listRecordingBlobKeys()` (line 605 of projectStorage.ts — single IDB `getAllKeys()` call, returns string[]) to build a Set, then stamp each item:

```ts
const blobKeys = new Set(await ProjectStorage.listRecordingBlobKeys());
for (const item of result) {
    item.hasLocalBlobs = blobKeys.has(`${item.id}-screen`);
}
```

Checking just the screen blob is sufficient — every project has one, and if screen is local then camera/mic are too (they're saved together during import).

### 1d. Return the wrapper

```ts
return { projects: result, cloudFetchFailed };
```

### 1e. Update `localToListItem()` helper

Add `hasLocalBlobs: false` as default (will be overwritten by the batch check in step 1c). This keeps the helper simple.

---

## Step 2: Add per-project failure tracking to sync status store

**File: `webapp/src/storage/syncStatusStore.ts`**

### 2a. Add to `SyncState` interface
```ts
failedUploads: Map<string, string>;  // projectId → error message
```

### 2b. Add actions to `SyncStatusStore`
```ts
setUploadFailed: (projectId: string, error: string) => void;
clearUploadFailed: (projectId: string) => void;
```

### 2c. Implement in the `create` call
```ts
failedUploads: new Map(),
setUploadFailed: (projectId, error) => set(state => {
    const next = new Map(state.failedUploads);
    next.set(projectId, error);
    return { failedUploads: next };
}),
clearUploadFailed: (projectId) => set(state => {
    const next = new Map(state.failedUploads);
    next.delete(projectId);
    return { failedUploads: next };
}),
```

---

## Step 3: Track upload failures in `SyncService.uploadProjectMedia()`

**File: `webapp/src/storage/syncService.ts`**

### 3a. On success (all blobs uploaded, line ~489)
After setting `uploadStatus: 'ready'`, also clear failure:
```ts
store.clearUploadFailed(projectId);
```

### 3b. On partial failure (after the upload loop, before finally)
If `uploaded < mediaTypes.length`:
```ts
store.setUploadFailed(projectId, `${mediaTypes.length - uploaded} file(s) failed to upload`);
```

---

## Step 4: Update dashboard filtering

**File: `webapp/src/pages/DashboardPage.tsx`**

### 4a. Update `loadProjects` to destructure new return type
```ts
const { projects: allProjects, cloudFetchFailed: fetchFailed } = await SyncService.listProjects(userId, ...);
setProjects(allProjects);
setCloudFetchFailed(fetchFailed);
```
Add state: `const [cloudFetchFailed, setCloudFetchFailed] = useState(false);`

### 4b. Update `visibleProjects` filter
```ts
const visibleProjects = useMemo(() => {
    if (cloudFetchFailed) {
        // Can't determine cloud state — show all local projects
        return projects.filter(p => p.hasLocal);
    }
    return projects.filter(p =>
        p.uploadStatus === 'ready' || p.hasLocalBlobs
    );
}, [projects, cloudFetchFailed]);
```

### 4c. Subscribe to sync status store for live upload state
```ts
const currentUpload = useSyncStatusStore(s => s.currentUpload);
const failedUploads = useSyncStatusStore(s => s.failedUploads);
```

### 4d. Compute per-project sync status
```ts
const getSyncStatus = (item: ProjectListItem): ProjectSyncStatus => {
    if (currentUpload?.projectId === item.id)
        return { type: 'uploading', progress: currentUpload.progress, fileType: currentUpload.type };
    if (failedUploads.has(item.id))
        return { type: 'failed', error: failedUploads.get(item.id)! };
    if (item.uploadStatus === 'pending' && item.hasLocalBlobs)
        return { type: 'pending' };
    return null;
};
```

### 4e. Pass `syncStatus` to each `ProjectCard`
```tsx
<ProjectCard ... syncStatus={getSyncStatus(item)} />
```

---

## Step 5: Add sync status icon to ProjectCard

**File: `webapp/src/components/ProjectCard.tsx`**

### 5a. Define type
```ts
export type ProjectSyncStatus =
    | { type: 'uploading'; progress: number; fileType: string }
    | { type: 'pending' }
    | { type: 'failed'; error: string }
    | null;
```

### 5b. Add prop
```ts
syncStatus?: ProjectSyncStatus;
```

### 5c. Render icon in the info row (next to `isShared` icon, line ~104)

Use Tabler icons already imported from `react-icons/tb`:
- **Uploading**: `TbCloudUpload` with `animate-pulse` + progress percentage text
- **Pending**: `TbCloudUpload` in `text-text-muted` (static)
- **Failed**: `TbCloudOff` in `text-destructive`

```tsx
{syncStatus?.type === 'uploading' && (
    <span className="flex items-center gap-0.5" title={`Uploading ${syncStatus.fileType}…`}>
        <TbCloudUpload className="icon-sm text-primary animate-pulse" />
    </span>
)}
{syncStatus?.type === 'pending' && (
    <TbCloudUpload className="icon-sm text-text-muted" title="Waiting to upload" />
)}
{syncStatus?.type === 'failed' && (
    <TbCloudOff className="icon-sm text-destructive" title={syncStatus.error} />
)}
```

---

## Verification

1. **Type check**: `npx tsc --noEmit --project webapp/tsconfig.json`
2. **Dev server**: Start app, verify dashboard loads correctly
3. **Test cloud-ready project**: Should display with no sync icon
4. **Test local uploading project**: Should display with pulsing upload icon
5. **Test failure scenario**: Kill network mid-upload, verify failed icon appears
6. **Test cloud-only pending project** (simulate Machine B): Should be hidden from the list
7. **Test cloud fetch failure**: All local projects should still display
