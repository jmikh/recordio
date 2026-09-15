# Screenshots — Step 9: Export

Parent: [screenshots-tiered-plan.md](./screenshots-tiered-plan.md)

## Goal
From the editor header: copy the rendered image to the clipboard, download it as PNG, download it
as a single-page PDF sized to the image. All client-side from `renderToCanvas`.

## Files
- `webapp/src/screenshot/export/exportScreenshot.ts` — `copyImageToClipboard` (ClipboardItem with a
  Blob promise so Safari keeps the user gesture), `downloadPng`, `downloadPdf` (lazy `import('jspdf')`,
  px units, one page per ≤ 19200 px band), `exportFileName`.
- `webapp/src/screenshot/components/ScreenshotExportActions.tsx` — header buttons: Copy image, a
  Download dropdown (PNG / PDF); toasts; busy state; `trackScreenshotExported`.
- `ScreenshotEditor.tsx` renders the actions inside `ScreenshotHeader`.
- `jspdf` added as a webapp dependency (lazy-loaded chunk).

## Decisions
- Clipboard failures fall back to a toast that offers the PNG download.
- PDF page size = image size in px (`hotfixes: ['px_scaling']`); pagination only guards the jsPDF
  page-size ceiling (14400 pt) since sources are already capped at 16384 px.
