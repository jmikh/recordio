# Screenshots — Step 12: E2E + polish

Parent: [screenshots-tiered-plan.md](./screenshots-tiered-plan.md)

## Goal
Playwright coverage of the screenshot product against the local stack, the extension mock's
screenshot handoff, and a final lint/typecheck sweep across all packages.

## Files
- `e2e/fixtures/assets/screenshot.png` — generated 640×360 PNG (no binary dependency).
- `e2e/fixtures/screenshot.ts` — `seedScreenshot(name)`: sign in, service-role upload of the PNG
  to `{userId}/screenshots/{id}/source.png`, `screenshot-create` with the app's own
  `createScreenshotDoc`, `screenshot-confirm-upload`; returns `{ screenshotId, slug, name, cleanup }`;
  `deleteScreenshot(id)` for app-created rows.
- `e2e/fixtures/extensionMock.ts` — `screenshot` option: HANDOFF_REQUEST answers with
  `kind: 'screenshot'` metadata and the port streams `'image'` chunks of the PNG.
- `e2e/tests/screenshot.spec.ts` — editor loads (name, canvas), a tool click creates an annotation
  and the inspector shows it, autosave reaches "Saved", share dialog shows owner controls, going
  public publishes the render and the public page shows it in a signed-out context, the dashboard
  Screenshots view lists and opens it, the import page receives a screenshot from the mocked
  extension and lands in the screenshot editor.

## Verification
- `npm run test:e2e -- screenshot.spec.ts` green against the running local stack; existing specs
  unchanged.
- `npx tsc -b` in webapp + extension, server typecheck, root eslint on changed files, vitest.
