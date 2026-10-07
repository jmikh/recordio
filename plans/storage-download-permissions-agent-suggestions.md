# Storage download permissions — agent suggestions

Found while implementing `storage-download-permissions-oneshot.md`; not
fixed there (out of scope). All six are planned in
`plans/storage-followups/storage-followups-tiered-plan.md`.

## 1. `project-create-v2` can overwrite someone else's project (security, high)
- **Where:** `server/src/routes/projects/projectCreateV2.ts`, the
  `INSERT … ON CONFLICT (id) DO UPDATE SET workspace_id, created_by,
  owner_id, name, project_data, upload_status, …`.
- **What:** The upsert exists so retries of the same import don't fail,
  but nothing checks that an existing row with that id belongs to the
  caller. Any workspace member can call it with another project's id and
  take the row over: new owner, new `project_data`, `upload_status` reset to
  pending. Project ids are not secret: `project-list` returns every
  project id in the workspace to every member.
- **Fix sketch:** add `WHERE projects.created_by = EXCLUDED.created_by AND
  projects.upload_status = 'pending'` to the `DO UPDATE`, and 409 when
  nothing came back (the `RETURNING` row is missing).

## 2. `project-list` returns other members' private projects (privacy, medium)
- **Where:** `server/src/routes/projects/projectList.ts` (no view filter).
  The dashboard hides them client-side
  (`webapp/src/pages/dashboard/DashboardPage.tsx`).
- **What:** Names, slugs, timestamps and ids of private projects go to
  every workspace member. Thumbnails are now withheld (`thumbnail_url` is
  null), but the metadata isn't.
- **Fix sketch:** filter rows with the same `can_view` predicate the route
  now computes, after checking that the Trash and admin views don't rely
  on the unfiltered list. Same question for `screenshot-list`.

## 3. Camera matte path built on the client (hygiene)
- **Where:** `webapp/src/editor/cameraMatte/cameraMatteJob.ts:69`
  (`cloudStoragePath(session.user.id, …)`), uploaded via TUS.
- **What:** The last client-side path builder. The storage write policy
  (`supabase/migrations/20260602212305_…project_media.sql`) only allows a
  client to write under its own id, so a collaborator's matte lands under
  their prefix. It still signs, because it's in the project namespace, but
  the purge job (which lists `created_by/projectId/`) misses it.
- **Fix sketch:** a server route that returns a presigned PUT for
  `projectMediaPath(created_by, projectId, 'cameraMatte')`, then delete
  `cloudStoragePath` from `shared/utils/projectMedia.ts`.

## 4. Renders still under the requester's prefix (hygiene)
- **Where:** `server/src/services/storagePaths.ts` `projectRenderPath`
  (called with the requester's id from `renderJobs.ts`).
- **What:** That was only needed because downloads went through the
  caller-prefix check. Downloads now use `render_url`, so renders can move
  under `created_by`, and the purge job then deletes collaborators' renders
  too.

## 5. Defaults page never shows a stored custom background (bug, low)
- **Where:** `webapp/src/pages/settings/personal/DefaultsPreview.tsx:52`
  reads `mediaUrls[bg.storagePath]`, which is only filled when a
  background is picked in the same session.
- **Fix sketch:** resolve it through `useAssetLibraryStore.resolveBlobUrl`
  when the path is a library asset.

## 6. Flaky `adminImpersonation` subscriber-list test (test hygiene)
- **Where:** `server/test/adminImpersonation.test.ts` "lists subscribers…".
- **What:** It failed once in a full parallel run and passed alone and on
  rerun. It likely reads subscriptions other suites seed concurrently.
