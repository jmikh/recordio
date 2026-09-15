# Screenshots — Step 10: Share

Parent: [screenshots-tiered-plan.md](./screenshots-tiered-plan.md)

## Goal
Share a screenshot by policy (private / workspace / public + view/edit) from the editor, publish
the flattened render the public page serves, and a `/screenshot/{slug}` view page.

## Files
- `webapp/src/screenshot/publish.ts` — `publishRenderIfNeeded(image, doc, meta)`: skips when
  private or when `renderCloudVersion` already matches the saved `cloudVersion`; renders the PNG,
  uploads via `ScreenshotService.publishRender`, retries once on 409 with the newer version; updates
  the meta store.
- `webapp/src/screenshot/components/ScreenshotShareModal.tsx` — `SharePolicyControls` +
  `ShareCreatorRow` + `OwnerOnlyNote` + Copy link; optimistic policy updates through
  `ScreenshotService.shareScreenshot`; publishes when leaving private and on Copy link (editor only —
  the dashboard opens it without an image and shows a "publish from the editor" note when there is
  no render yet).
- `webapp/src/screenshot/components/ScreenshotShareButton.tsx` — header Share button gated by
  `entitlements.canShare` (else `ProUpgradeModal`).
- `ScreenshotEditor.tsx` — re-publish after each successful save while not private (same effect as
  the thumbnail).
- `webapp/src/pages/ScreenshotViewPage.tsx` — mirrors `VideoPage`: header, attribution, 403 →
  sign-in prompt, 404, "not published yet" when `imageUrl` is null, `stale` note, `<img>`, Copy link,
  Download (fetch the presigned URL → blob → save).
- `App.tsx` — `/screenshot/{slug}` route (ungated).
- analytics: `trackScreenshotShared`, `trackScreenshotViewed`.

## Decisions
- The public page only ever receives the render URL (never the source), so blur is real privacy.
- Re-publish is triggered from the editor's save cycle, not from the server; `stale` is transient.
