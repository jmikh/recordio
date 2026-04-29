# Plan: Background Upload — Edit While Syncing

## Context

Today, after recording stops, the import page blocks the user while it:
1. Streams blobs from extension → webapp (fast, local)
2. Uploads blobs to Supabase Storage via TUS (slow, network)
3. Caches blobs locally in BlobCache (fast)
4. Only then navigates to the editor

The goal is to let users start editing immediately after recording, while media uploads happen in the background.

## Key Invariants

- **No project metadata saves until media is fully synced** (`upload_status = 'ready'`). Keeps cloud state simple — a project is either fully synced or not remotely usable.
- **Auth stays on webapp** — import page confirms auth before anything else.
- **Local editing works during sync** — blobs are in BlobCache, playback works, user can edit freely.
- **Edits are buffered locally** — once sync completes, all accumulated edits save to cloud.
- **Leaving during sync = data loss warning** — "project media is not fully synced, you will lose access if you leave this page."
- **Sync failure = blocking modal** — after 2-3 retries, show error + retry button. User cannot continue until resolved.

## Architecture

### Current flow
```
Extension → Import Page → [auth] → [stream blobs] → [upload to Supabase] → [cache] → Editor
                                                      ^^^^ user waits ^^^^
```

### New flow
```
Extension → Import Page → [auth] → [stream blobs] → [create project row]
                                  → [cache blobs locally] → [start resumable upload]
                                  → Navigate to Editor immediately
                                                              ↓
                                              Editor: local editing works (cached blobs)
                                              Syncing indicator (animated/pulsing cloud icon)
                                              Project saves HELD until sync complete
                                                              ↓
                                              Upload completes → upload_status = 'ready'
                                              → Flush buffered edits to cloud
                                              → Enable share/export/transcribe
                                                              ↓
                                              Upload fails (after 2-3 retries)
                                              → Blocking modal: error message + retry button
```

## Implementation

### Phase 1: Split `importRecording` into local + background parts

**File: [cloudProjectService.ts](webapp/src/storage/cloudProjectService.ts)**

Refactor `importRecording()` into two steps:

1. **`importRecordingLocal()`** — fast, runs on import page:
   - Confirm auth (same as today)
   - Build project from recording
   - Create project row in Supabase (with `upload_status: 'pending'`)
   - Cache blobs locally via `BlobCache.put()`
   - Populate `useMediaUrlStore` with `blob:` URLs for playback
   - Start TUS resumable upload (non-blocking — upload handle returned)
   - Return `{ project, uploadHandle }` so editor can track progress

2. **`uploadMedia()`** — continues in editor:
   - Upload screen/camera/mic blobs via `CloudStorage.uploadMediaFile()` (TUS, resumable)
   - Update `useSyncStatusStore` with progress
   - On completion: `upload_status = 'ready'`
   - On failure after 2-3 retries: set error state → triggers blocking modal
   - On success: flush any buffered project edits via `saveProject()`

### Phase 2: Update ImportPage

**File: [ImportPage.tsx](webapp/src/pages/ImportPage.tsx)**

- After blobs received + auth confirmed → call `importRecordingLocal()`
- Store blobs + upload state in `pendingUploadStore` (in-memory)
- Navigate to editor immediately with the new project ID
- Remove upload progress UI from import page (it moves to editor)

### Phase 3: Hold saves during sync

**File: [cloudProjectService.ts](webapp/src/storage/cloudProjectService.ts)**

- `saveProject()` checks `useSyncStatusStore.pendingMediaUploads > 0`
- If pending → skip the cloud write (edits stay in local zustand state only)
- When sync completes → trigger a save with the current project state to flush edits

**File: [useProjectStore.ts](webapp/src/editor/stores/useProjectStore.ts)**

- `saveProject` action already calls `CloudProjectService.saveProject()` — no change needed there
- The gate lives in `CloudProjectService.saveProject()` itself

### Phase 4: Background upload hook in editor

**New file: `webapp/src/hooks/useBackgroundUpload.ts`**

- On editor mount, check `pendingUploadStore` for this project's blobs
- If found, kick off `CloudProjectService.uploadMedia()`
- Wire up progress to `useSyncStatusStore`
- Handle `beforeunload`: warn "project media is not fully synced to cloud, you will lose access to the project if you leave this page"
- On upload complete: clear pending state, flush edits
- On failure after retries: set error → blocking modal shown

### Phase 5: Sync status UI in editor

**File: [Header.tsx](webapp/src/editor/components/header/Header.tsx)**

Sync indicator next to project name:
- **Syncing**: animated/pulsing cloud icon showing upload is in progress
- **Ready**: no indicator (clean)
- **Error**: red exclamation — but this state triggers the blocking modal, so the icon is secondary

**Blocking modal on failure** (new component or inline in App.tsx):
- "Failed to sync project media to cloud"
- Error message detail
- "Retry" button → re-attempts upload
- No dismiss/close — must retry or resolve

**Block cloud features while syncing:**
- Share, export, transcribe buttons disabled
- Tooltip: "Syncing to cloud..."

### Phase 6: Leave-page protection

**File: `useBackgroundUpload.ts` hook**

- Register `beforeunload` handler while `pendingMediaUploads > 0`
- Message: "Project media is not fully synced to cloud. You will lose access to the project if you leave this page."
- Remove handler when sync completes

## Files to modify

| File | Change |
|------|--------|
| `webapp/src/storage/cloudProjectService.ts` | Split import, gate saves during sync, flush on complete |
| `webapp/src/storage/cloudStorage.ts` | No changes expected (reuse existing upload methods) |
| `webapp/src/pages/ImportPage.tsx` | Fast local import, navigate immediately |
| `webapp/src/editor/App.tsx` | Mount background upload hook |
| `webapp/src/editor/components/header/Header.tsx` | Sync indicator + disable cloud features |
| `webapp/src/storage/syncStatusStore.ts` | May need `mediaUploadError` field for modal |

## Files to create

| File | Purpose |
|------|---------|
| `webapp/src/hooks/useBackgroundUpload.ts` | Background upload lifecycle, beforeunload, retry logic |
| `webapp/src/storage/pendingUploadStore.ts` | In-memory blob store to pass from import → editor |
| `webapp/src/editor/components/SyncFailedModal.tsx` | Blocking modal for upload failure |

## Existing code to reuse

- `useSyncStatusStore` — already has `pendingMediaUploads`, `currentUpload`, `error`, `status` ([syncStatusStore.ts](webapp/src/storage/syncStatusStore.ts))
- `CloudStorage.uploadMediaFile()` — TUS upload with progress + auto-retry ([cloudStorage.ts](webapp/src/storage/cloudStorage.ts))
- `BlobCache.put()` — local cache write ([blobCache.ts](webapp/src/storage/blobCache.ts))
- `useMediaUrlStore` — blob URL management for playback
- TUS client already has retry delays: `[0, 3000, 5000, 10000, 20000]` — covers retries at the chunk level. Our 2-3 retries are at the full-upload level.

## Verification

1. **Happy path**: Record → import page (auth + create project + cache) → editor opens → cloud icon pulses → upload completes → icon gone → share/export/transcribe enabled → edits auto-save
2. **Slow network**: Editor opens, editing works locally, cloud icon pulses for longer → eventually completes → edits flush
3. **Upload failure**: Cloud icon → after 2-3 retries → blocking modal with error + retry button → retry succeeds → modal closes → normal operation
4. **Leave during sync**: `beforeunload` warns about losing access → if they stay, sync continues → if they leave, project stuck in `pending` state (no media on cloud)
5. **Re-open pending project**: Project shows in dashboard but media missing → needs re-recording (no recovery path for now since blobs may be evicted from cache)
6. **Not logged in**: Import page shows auth modal (same as today) → after login, fast import + editor opens
