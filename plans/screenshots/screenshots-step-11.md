# Screenshots — Step 11: Dashboard

Parent: [screenshots-tiered-plan.md](./screenshots-tiered-plan.md)

## Goal
A "Screenshots" section in the dashboard sidebar (with the free-plan screenshot meter), a grid of
screenshot cards with open / rename / share / delete, and a Trash view that shows videos and
screenshots together.

## Files
- `pages/dashboard/DashboardSidebar.tsx` — `DashboardView` += `'screenshots'`; "Screenshots"
  (`LuImage`) item with count; a second usage meter for `screenshotCap` (extracted `UsageMeter`).
- `pages/dashboard/ScreenshotsView.tsx` — title + grid of `ProjectCard`s (image badge, no duration,
  screenshot share URL), empty state pointing at the extension's Image mode.
- `pages/dashboard/DashboardPage.tsx` — loads `screenshot-list` next to `project-list`, derives
  visible / owned / trashed screenshots, dispatches open (edit vs view by access), rename, delete,
  restore (`canRestore` gate), share (hydrates `useScreenshotMetaStore` → `ScreenshotShareModal`
  without an image); Trash merges both kinds sorted by deletion time.

## Decisions
- Screenshots view lists the caller's own screenshots plus workspace/public ones (policy-only
  sharing has no per-user grants).
- Search / duration filters stay video-only; the screenshot grid is sorted newest first.
