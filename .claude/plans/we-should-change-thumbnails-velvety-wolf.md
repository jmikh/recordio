# Deterministic project thumbnails (oneshot)

> On implementation, copy this doc to `plans/project-thumbnails-oneshot.md` (planning skill convention).

## Context

Project thumbnails are currently scraped from the **live editor canvas** inside the rAF loop
([CanvasContainer.tsx:323-341](webapp/src/editor/components/canvas/CanvasContainer.tsx#L323-L341),
timers at `:372-400`): 1.5s after project load and 2s after a background change, at whatever
playhead / zoom / spotlight state the user happens to be in. Consequences:

- Thumbnails are non-deterministic (mid-zoom, mid-spotlight, arbitrary playhead — usually frame 0,
  which is often blank for a screen recording).
- A project that is never opened in the editor never gets a thumbnail.
- Two cache bugs: `saveThumbnail` writes the local `BlobCache` under a client-derived key
  `${projectId}/thumbnail.webp` while the server stores/returns `${userId}/${projectId}/thumbnail.webp`
  ([cloudProjectService.ts:679](webapp/src/storage/cloudProjectService.ts#L679) vs
  [projectUpdateThumbnail.ts:86](server/src/routes/projects/projectUpdateThumbnail.ts#L86)). The local
  write is dead, and the dashboard's cache entry under the real key is never refreshed → **stale
  thumbnails forever** (the storage path is stable, so a cache hit never re-downloads).
- The server namespaces the object by the *caller's* id, so a shared project's thumbnail path flips
  between owner and editor prefixes.

## Decisions (agreed with user)

1. **Thumbnail = one still frame rendered offscreen** with the shared `PlaybackRenderer`, at the
   **middle of the output duration**, with every *dynamic* layer hidden: all timeline segments
   (zoom, spotlight, cameraMove, captions, overlays) treated as empty; mouse click/drag effects and
   hotkeys off; `userEvents = EMPTY_USER_EVENTS`. **Kept:** background, screen crop/padding, device
   frame or border, browser toolbar chrome, camera PiP at its default position/shape.
2. **Triggers:** (a) project creation, (b) leaving the editor for the dashboard, (c) editor open when
   the server has no thumbnail (backfill for existing projects). Not on autosave.
3. **Client never derives storage paths.** Cache under the `storagePath` the server returns from
   `uploadThumbnail` — same pattern as [userAssetService.ts:88-91](webapp/src/storage/userAssetService.ts#L88-L91).
4. Server stores the object under the **project owner's** prefix (`owner_id` is already returned by
   `getProjectIfEditor`), not the caller's.

## Design

_(implementation detail filled in below once the Plan agent reports)_
