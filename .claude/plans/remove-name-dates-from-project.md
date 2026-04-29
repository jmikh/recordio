# Remove `name`, `createdAt`, `updatedAt` from Project interface

## Context

`name`, `createdAt`, and `updatedAt` are duplicated — they exist both as columns on the `projects` DB table AND inside the `project_data` JSON blob. This causes the name to be saved on every debounced auto-save via `project_update`, when it should just be a direct DB column update. Removing these from the Project type eliminates the duplication. Name updates get their own dedicated API function with no debouncing.

## Plan

### 1. New SQL function: `project_update_name`

**New file:** `webapp/supabase/sql/functions/project_update_name.sql`

Simple function: `project_update_name(p_project_id UUID, p_name TEXT)` — updates the `name` column directly. Returns void. Auth via `auth.uid()`.

Then run `sql/build-functions.sh` to generate the migration.

### 2. Update `project_update` SQL function

**File:** `webapp/supabase/sql/functions/project_update.sql`

Remove `p_name` parameter. The UPDATE statements no longer set `name =`.

### 3. Remove fields from `Project` interface

**File:** `shared/types/project.ts`

Remove `name: string`, `createdAt: Date`, `updatedAt: Date` from the `Project` interface.

### 4. Update `ProjectImpl` factory methods

**File:** `webapp/src/core/Project.ts`

- `create()`: Remove `name` param, remove `name`, `createdAt`, `updatedAt` from returned object
- `createFromSource()`: Remove `rawName` param, remove `name`, `createdAt`, `updatedAt` from returned object. Keep the name truncation logic but return it separately or move it to the caller.

Since `importRecordingLocal` needs to pass the name to `project-create`, `createFromSource` should return `{ project, name }` or the caller computes the name.

### 5. Update project store

**File:** `webapp/src/editor/stores/useProjectStore.ts`

- Add `projectName: string` as top-level state (like `userEvents` — not part of undo/redo)
- `loadProject` signature changes to accept name: `loadProject(project: Project, name: string)`
- `updateProjectName` updates `projectName` locally AND calls `CloudStorage.updateProjectName()` immediately (no debounce, fire-and-forget)
- Remove `updatedAt: new Date()` from `updateProjectName`
- Default `projectName: 'Untitled Project'`

### 6. Update CloudStorage

**File:** `webapp/src/storage/cloudStorage.ts`

- `saveProjectMetadata()`: Remove `p_name: project.name` from the RPC call
- Add new static method `updateProjectName(projectId: string, name: string)` that calls `project_update_name` RPC
- `loadProjectMetadata` already returns the `name` column — callers can read it from `CloudProject.name`

### 7. Update CloudProjectService

**File:** `webapp/src/storage/cloudProjectService.ts`

- `importRecordingLocal()`: Compute name from `recording.name` (with truncation), pass it to `project-create` edge function as a separate field, not embedded in project
- `loadProject()`: Extract `cloudProject.name` and return it alongside the project, or change return type to `{ project, name }`
- `saveProject()`: For the conflict case, read name from the store instead of `project.name`

### 8. Update `project-create` edge function

**File:** `webapp/supabase/functions/project-create/index.ts`

Line 86: Change from `project.name ?? 'Untitled'` to reading a separate `name` field from the request body.

### 9. Update editor components that read `project.name`

All these switch from `useProjectData().name` to `useProjectStore(s => s.projectName)`:

- **Header.tsx** (line 148): Name input reads/writes `projectName`
- **ExportModal.tsx** (lines 258, 337): Download filename and share call
- **CaptionsSettings.tsx** (line 175): SRT download filename
- **ExportManager.ts** (line 63): Download filename
- **ConflictModal.tsx** (line 70): Already reads from sync store, no change needed

### 10. Update screenPainter

**File:** `shared/painters/screenPainter.ts`

The `drawScreenFrame` function signature needs a new `projectName: string` parameter for the toolbar fallback text (lines 129-130, 225-226). Callers pass it in.

Callers to update:
- Webapp playback renderer (passes name from store)
- Render worker render-page (passes name from job payload)

### 11. Update render pipeline

- **`render-start-job/index.ts`**: Add `name` to the SELECT query (line 46), pass `name` in the worker payload
- **`render-worker/src/server.ts`**: Accept `name` in the job payload
- **`render-worker/render-page/main.ts`**: Read `name` from job, use for log + pass to ExportManager/screenPainter

### 12. Update project transfer (ZIP export)

**File:** `webapp/src/storage/projectTransfer.ts`

- Line 58: Read name from store instead of `project.name`
- Line 116: When building RawRecording for re-import, get name from store

### 13. Update App.tsx / editor load flow

**File:** `webapp/src/editor/App.tsx`

Line 308 passes `projectName={project.name}` — update to read from store's `projectName`.

### 14. Migration cleanup

**File:** `webapp/src/core/migrateProject.ts`

Add a step that strips `name`, `createdAt`, `updatedAt` from old project data during migration (so loading old projects doesn't carry stale values).

---

## Files to modify (summary)

| File | Change |
|------|--------|
| `shared/types/project.ts` | Remove 3 fields |
| `webapp/src/core/Project.ts` | Remove fields from create/createFromSource |
| `webapp/src/editor/stores/useProjectStore.ts` | Add `projectName` top-level state |
| `webapp/src/storage/cloudStorage.ts` | Remove name from save, add `updateProjectName` |
| `webapp/src/storage/cloudProjectService.ts` | Return name alongside project on load |
| `webapp/supabase/sql/functions/project_update.sql` | Remove `p_name` |
| `webapp/supabase/sql/functions/project_update_name.sql` | **New file** |
| `webapp/supabase/functions/project-create/index.ts` | Read name from separate field |
| `webapp/src/editor/components/header/Header.tsx` | Read from `projectName` |
| `webapp/src/editor/components/settings/ExportModal.tsx` | Read from `projectName` |
| `webapp/src/editor/components/settings/CaptionsSettings.tsx` | Read from `projectName` |
| `webapp/src/editor/export/ExportManager.ts` | Read name from param or store |
| `webapp/src/storage/projectTransfer.ts` | Read name from store |
| `shared/painters/screenPainter.ts` | Add `projectName` param |
| `webapp/src/editor/App.tsx` | Pass name from store |
| `render-worker/render-page/main.ts` | Read name from job |
| `webapp/supabase/functions/render-start-job/index.ts` | Pass name in payload |
| `webapp/src/core/migrateProject.ts` | Strip old fields |
| `webapp/src/storage/syncStatusStore.ts` | No change (conflict already uses separate field) |

## Verification

1. TypeScript: `npx tsc --noEmit` across webapp, shared, render-worker — no errors referencing removed fields
2. Editor: Open project, verify name displays in header, rename works and persists immediately
3. Auto-save: Verify project changes still auto-save (without name)
4. Dashboard: Verify project list still shows names, sorting works
5. Export: Verify download filename uses project name
6. Toolbar: Verify screen toolbar fallback still shows project name
