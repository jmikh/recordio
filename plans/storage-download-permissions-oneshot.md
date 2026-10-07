# Storage download permissions (oneshot)

## Context

`POST /storage-download-urls` signs any path that starts with the caller's
user id (plus a hard-coded admin id that bypasses the check). Project and
screenshot files live under their **creator's** prefix, so any other user
with access gets a 403 on a cache miss:

- a collaborator opening someone else's project (editor media batch fails)
- a collaborator opening someone else's screenshot (source image fails)
- any dashboard that lists other members' projects/screenshots (the whole
  thumbnail batch fails, cache hits included, because `getBlobUrls` rejects)

Confirmed in a local build (2026-10-07). It went unnoticed because downloads
are cache-first and the developer account is the bypassed admin id.

## Design

**Signing moves to the routes that check access.** Each route that
authorizes a resource also returns presigned GET URLs for that resource's
files. This is the existing `asset-list` pattern: the client passes them to
`BlobCache` as known URLs. With that in place `storage-download-urls` has no
callers and is deleted. That removes the only endpoint that signed arbitrary
paths.

| Route | Access check (existing) | New field |
|---|---|---|
| `project-get` | `canEditProject` | `media_urls: Record<path, url>` for every media path |
| `project-list` | workspace member | `thumbnail_url` per row, **only** for rows the caller can view (owner, editor grant, or shared to workspace/public) |
| `screenshot-get` | `canEditScreenshot` | `source_url` |
| `screenshot-list` | workspace member | `thumbnail_url` per row, only for rows the caller can view (owner, or shared to workspace/public) |
| `render-job-get-status` | `canEditProject` | `render_url` when the job is completed |

URLs live 1h (`DOWNLOAD_URL_TTL_SECONDS`, one helper `presignDownloads`).
`project-get` media is hydrated immediately after the fetch, so there's no
refresh path. Render downloads always fetch a fresh URL from
`render-job-get-status` right before downloading, which also covers retry.

**Library assets are copied into the project.** A project only ever
references files inside its own namespace: `*/<projectId>/…`, checked with
`isProjectPath`. The first segment may be a collaborator (e.g. a
collaborator-generated camera matte), but the project id segment must match.

- New `POST /project-asset-attach { projectId, assetId }`: editor access
  plus the caller's own ready asset → server-side S3 copy to
  `projectAssetPath(created_by, projectId, '<assetId>.<ext>')`, the same
  layout `project-clone` already uses → `{ storagePath, downloadUrl }`.
- `project-create-v2`: any background/music path outside the new project
  becomes a copy if it's under the caller's own prefix (their library, or
  their own project copied into their defaults via "Use as my default
  settings"). Otherwise the copy fails and the background resets to
  `type: 'color'`, logged; the import is never failed over a default.
- Defaults templateMode (no real project) keeps referencing the library path
  directly.
- Deleting a library asset no longer affects projects that use it. They
  have their own copy, and the purge job deletes it with the project.

**Saves validate storage paths.** `project-update` rejects (400
`invalid_storage_path`) any media path in the new `project_data` that is
neither in the stored version nor inside the project namespace. Stale
versions are answered with a conflict first, before validation, so an
editor holding pre-migration data gets the normal conflict reload instead of
a 400.

**`project-get` signing rule:** sign a media path if it's inside the
project namespace **or** under the caller's own prefix (the old rule, a safe
fallback for not-yet-migrated references). Anything else is skipped and
logged.

**Legacy backfill moves to the server.** `project-get` fills missing
screen/camera/mic paths on pre-v5 projects with `projectMediaPath(created_by,
…)`, replacing the client's `cloudStoragePath` backfill.

**One-off migration** `server/scripts/projectAssetsLocalize.ts`: for every
non-purged project whose background/music path is outside its namespace,
S3-copy into the project and rewrite `project_data`, bumping
`cloud_version` so open editors get a conflict instead of a validation 400.
Dry-run by default, `--apply` to write. Run right after deploy.

### Out of scope
- Camera matte upload still builds its path on the client and uploads via
  TUS under the uploader's prefix. It's inside the project namespace, so it
  signs fine. A server-issued upload is a separate change.
- Renders stay under the requester's prefix for now. That's no longer
  required once downloads go through `render_url`, so they can move later.
- Cross-device thumbnail staleness (same path reused) — separate.

## Steps

### Server
1. `storagePaths.ts`: add `projectAssetPath`, `isProjectPath`, `isUserPath`.
   `services/downloadUrls.ts`: `presignDownloads(s3, paths)`.
2. `project-get`: legacy path backfill and `media_urls` (signing rule above).
3. `project-update`: early conflict, then path validation.
4. `project-create-v2`: copy own-prefix background/music into the project,
   or reset it.
5. New `project-asset-attach` route and shared API schema.
6. `project-list` / `screenshot-list`: `thumbnail_url` for viewable rows.
   `screenshot-get`: `source_url`. `render-job-get-status`: `render_url`.
7. Delete `storage-download-urls` (route, registration, tests, admin id,
   impersonation allowlist entry). `project-clone` uses `projectAssetPath`.
8. `server/scripts/projectAssetsLocalize.ts` migration.

### Client
9. `BlobCache`: `knownUrl(s)` required. Remove
   `CloudStorage.requestDownloadUrl(s)` / `downloadMediaFile`.
10. Editor load: drop client backfill; thread `media_urls` into
    `hydrateMediaUrls`.
11. Dashboard thumbnails (projects, screenshots, Cap recovery panel) use
    list URLs. Screenshot editor uses `source_url`.
12. `cloudRenderService`: track the job id; download via a fresh
    `render_url`.
13. `selectBackground` / `selectMusic` take the asset: attach (project mode)
    or library path (templateMode). Seed the project copy's cache entry from
    the cached library blob. Settings panels pass assets and match the
    "selected" state by file name (`<assetId>.<ext>`).

### Verify
14. Server tests per route (signing visibility, validation, attach, create
    copy/reset, migration dry-run), client tests updated. Typecheck both.
15. Manual: a second user with an edit grant opens the owner's project and
    screenshot in a fresh browser context (empty cache); dashboard
    thumbnails load for both users.

## Log
- Implemented 2026-10-07 (steps 1–14). Step 15, the manual two-user check
  in a fresh browser context, is still open. Implementation details beyond
  the design above:
  - `BlobCache.getBlob/getBlobUrl(path, url, onProgress?)`: the URL moved
    to the second argument and is required. A miss without one throws
    (single) or is skipped (batch).
  - Render tasks track `renderJobId` instead of `renderStoragePath`.
    `render-job-create` no longer needs to return a path to the client.
  - The client matches a project's asset copy to its library entry by
    file name (`isSameAsset` in `userAssetService.ts`) for the "selected"
    highlight. Deleting a library asset clears the selection only when the
    exact library path is referenced (defaults template / unmigrated
    projects).
  - `CloudProjectService.loadProject` (combined fetch+hydrate wrapper)
    removed. Conflict reload calls the two halves.
  - Migration dry-run on local data: 1 project to rewrite.
