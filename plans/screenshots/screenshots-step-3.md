# Screenshots — Step 3: Extension popup + visible-area capture + handoff

Parent: [screenshots-tiered-plan.md](./screenshots-tiered-plan.md)

## Goal
The Video | Image toggle in the popup, the image capture view, and the first capture mode
(visible area) working end to end: capture → IndexedDB → `/import?…&kind=screenshot` → the webapp
receives a `kind: 'screenshot'` handoff over the bridge (the import page itself lands in Step 6).
Region and full-page buttons exist but return "not available yet" until Steps 4–5.

## Files
- `extension/src/shared/messageTypes.ts` — all screenshot message types, storage keys and payload
  types (Steps 4–5 only add handlers, not names).
- `extension/src/storage/projectStorage.ts` — `saveRawScreenshot`, `loadRawItem`.
- `extension/src/background/screenshotCapture.ts` (new) — session state mirrored to
  `chrome.storage.session`, throttled `captureVisibleTab`, decode, persist, open import tab, error
  path (badge `!` + `SCREENSHOT_ERROR` + `openPopup`), tab guards.
- `extension/src/background/background.ts` — `POPUP_CAPTURE_SCREENSHOT` / `POPUP_CANCEL_SCREENSHOT`
  cases, `onRemoved`/`onUpdated` guards, handoff branch for screenshots.
- `extension/src/popup/prefs.ts` (new) — merged read/write of `recordio_prefs` (fixes
  `PreRecordingView` overwriting the whole object).
- `extension/src/popup/activeTab.ts` (new) — shared "is the active tab capturable" check.
- `extension/src/popup/PopupApp.tsx` — header toggle, mode persistence, screenshot error panel,
  in-progress view.
- `extension/src/popup/ImageCaptureView.tsx` (new) — three capture rows + capturing/cancel view.
- `extension/src/utils/mixpanel.ts` — `trackScreenshotCaptured`, `trackScreenshotError`.

## Decisions
- Visible mode is awaited by the popup (it shows "Capturing…" on the row); the import tab opening
  steals focus and closes the popup. Region/full-page will ack immediately and close the popup.
- Chrome caps `captureVisibleTab` at 2 calls/s — a module-level throttle (≥510 ms) with one retry.
- Scale is derived from the bitmap (`bitmap.width / viewport.width`), not from `devicePixelRatio`.
- `RawScreenshot` lives in the existing IndexedDB `projects` store (discriminated by `kind`), the
  PNG under `shot-<id>-image` in `recordings` — no DB version bump.

## Verification
- `npm run build:extension:dev` builds; load unpacked; Image → Visible area on an http page opens
  `/import?id=…&ext=…&kind=screenshot`; the import page shows the Step 1 "not available yet" error
  (expected until Step 6). Recording flow unchanged.
