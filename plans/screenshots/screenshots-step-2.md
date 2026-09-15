# Screenshots — Step 2: Server routes + entitlements + purge

Parent: [screenshots-tiered-plan.md](./screenshots-tiered-plan.md)

## Goal
Every server-side surface the webapp needs for screenshots, each a sibling of the matching project
route with the same auth/validation/logging conventions, backed by the `screenshots` table from Step 1.

## Files
- `server/src/services/screenshotAccess.ts` — `getScreenshotIfEditor`, `canEditScreenshot`,
  `canViewScreenshot`. Edit = owner OR non-viewer workspace member when
  `share_policy IN ('workspace','public') AND workspace_access='edit'`; view = public OR owner OR
  any member when `share_policy='workspace'`. All require a live screenshot in a live workspace.
- `server/src/routes/screenshots/` — `screenshotCreate`, `screenshotConfirmUpload`, `screenshotGet`,
  `screenshotList`, `screenshotUpdate`, `screenshotRename`, `screenshotDelete`, `screenshotRestore`,
  `screenshotShare`, `screenshotUpdateThumbnail` (multipart), `screenshotRenderUpload` (multipart).
- `server/src/routes/sharedScreenshotGet.ts` — public view-page route (`optionalUser`, 60/min).
- `server/src/jobs/screenshotsPurgeDeleted.ts` + registration in `jobs/index.ts`
  (`screenshots.purge-deleted`, daily, 30 days, deletes the `{created_by}/screenshots/{id}/` prefix).
- `server/src/app.ts` — register the new route plugins.
- Tests under `server/test/screenshots/` + `server/test/jobs/screenshotsPurgeDeleted.test.ts`.

## Decisions
- Storage keys always use the row's `created_by` prefix (thumbnail included) — no caller-id
  flip-flop like the project thumbnail route has.
- `screenshot-render-upload` checks `cloud_version` BEFORE the S3 put (cheap 409), then
  compare-and-sets; a lost race after the put deletes the object and 409s. The previous render is
  deleted best-effort after a successful swap.
- `screenshot-update` no-op path (unchanged JSON) returns the current version without touching
  `updated_at` (the project route bumps it — a no-op save shouldn't reorder the dashboard).
- `shared-screenshot-get` inlines the public/auth_required/canView ladder (three lines); no
  `sharedAccess.ts` extraction since the two tables' view checks differ anyway.
- The cap counts live (ready, not deleted) screenshots owned by the caller in the workspace,
  excluding the id being upserted (retry-safe), mirroring `project-create-v2`.

## Verification
- `npx vitest run server/test/screenshots server/test/jobs/screenshotsPurgeDeleted.test.ts` green
  against the local stack.
- `npx tsc --noEmit -p server/tsconfig.json` clean; eslint clean on new files.
