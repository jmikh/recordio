# Download Modals

## Context
The download button currently triggers cloud rendering inline with progress shown on the button itself. We want to replace this with a modal-based UX that differs by user tier:
- **Free users**: Local (in-browser) rendering with a non-dismissible modal + upgrade CTA
- **Pro users**: Cloud rendering with a dismissible modal + browser notification on completion

## Files to Create
- `webapp/src/editor/components/settings/DownloadModal.tsx` — single modal component with conditional rendering based on `isPro`
- `webapp/src/editor/components/settings/useCloudRender.ts` — extracted cloud render hook from SettingsPanel

## Files to Modify
- `webapp/src/editor/components/settings/SettingsPanel.tsx` — remove inline render logic, add modal open state, render DownloadModal
- `webapp/src/editor/components/settings/useLocalRender.ts` — remove dev-only comments (hook is already production-ready)

## Files to Delete
- `webapp/src/editor/components/settings/LocalRenderControls.tsx` — replaced by local mode in DownloadModal

## Implementation

### 1. Extract `useCloudRender.ts` from SettingsPanel
Move lines 98-216 of SettingsPanel into a dedicated hook:
- State: `isRendering`, `renderProgress`, `isDownloading`, `phase` (`'idle' | 'saving' | 'queued' | 'rendering' | 'downloading' | 'completed' | 'failed'`)
- Methods: `startCloudRender(project, projectName, isPro)`, `cleanup()`
- Keeps polling logic (`pollRef`) internal
- On completion: triggers file download, sends browser notification via `Notification` API, returns to idle

### 2. Create `DownloadModal.tsx`
Single component, two modes based on `isPro`:

**Props:**
```ts
interface DownloadModalProps {
  isOpen: boolean;
  onClose: () => void;
  // Cloud render state (lives in SettingsPanel so it persists across modal close/reopen)
  cloudPhase: string;
  cloudProgress: number;
  onStartCloudRender: () => void;
  // Upgrade flow
  onUpgrade: () => void;
}
```

**Local mode (free users):**
- `Modal` with no `onClose` prop (disables backdrop click-to-close)
- No XButton
- Auto-starts local render via `useLocalRender` (called inside the modal)
- Progress bar + phase text ("Preparing..." / percentage)
- GPU decode fallback notice when applicable
- Cancel button (cancels export, closes modal via parent callback)
- Upgrade banner at bottom: "Upgrade to Pro for faster cloud rendering" with upgrade button

**Cloud mode (Pro users):**
- `Modal` with `onClose` prop (enables backdrop click-to-close)
- XButton in top-right
- Auto-starts cloud render on open (calls `onStartCloudRender`)
- Queued state (progress === 0): spinner + "Queued..." text
- Rendering state (progress > 0): progress bar with percentage
- Downloading state: spinner + "Downloading..."
- Message: "You can close this dialog. We'll notify you when your file is ready."
- Close button at bottom

### 3. Update SettingsPanel
- Remove inline cloud render state/logic (replaced by `useCloudRender` hook)
- Call `useCloudRender()` at component level (state persists across modal open/close)
- Add `isDownloadModalOpen` state
- `handleDownload`: check auth → set `isDownloadModalOpen(true)`
- **Download button keeps inline progress for cloud rendering**: when `isRendering`, show spinner + "Rendering..." + progress bar on the button (same as current). Clicking the button while rendering reopens the modal instead of starting a new render.
- For free/local users: button resets to static "Download" after modal closes (local modal can't be closed during render anyway)
- Remove `LocalRenderControls` import and usage
- Add `DownloadModal` + `UpgradeModal` (if not already present) to render tree
- Add `isUpgradeModalOpen` state for upgrade flow from local modal

### 4. Browser Notifications for Cloud Render
In `useCloudRender`, when render completes:
1. Request `Notification.permission` if not already granted (request at render start time)
2. On completion: `new Notification('Export ready', { body: 'Your video is ready to download' })`
3. Also fire existing toast notification

### 5. Clean up
- Remove dev-only comments from `useLocalRender.ts`
- Delete `LocalRenderControls.tsx`

## Key Patterns to Reuse
- `Modal` component (`shared/components/Modal.tsx`) — pass no `onClose` to prevent dismissal
- Progress bar pattern from `ProgressModal.tsx` lines 42-53
- `XButton` from `shared/components/XButton.tsx`
- `Button` component for upgrade/close/cancel actions
- `useLocalRender` hook as-is (just remove dev-only docs)
- Toast via `useToast()` for completion notifications

## State Architecture
```
SettingsPanel
  ├── useCloudRender()  → owns cloud render lifecycle, survives modal close/reopen
  ├── useState(isDownloadModalOpen)
  ├── useState(isUpgradeModalOpen)
  └── <DownloadModal>
        └── useLocalRender()  → only active when modal is open (free users)
```

Cloud render state lives in SettingsPanel (via the hook) so polling continues when the modal is closed. Local render state lives inside the modal since it can't be closed during rendering.

## Verification
1. Run dev server, test as free user: click Download → local modal opens, renders in browser, cannot close, upgrade button opens UpgradeModal
2. Test as Pro user: click Download → cloud modal opens, shows queued/progress, can close, browser notification fires on completion
3. Test Pro user closing modal mid-render → reopen shows current progress
4. Test cancel on local render modal
5. Test auth gate still works (unauthenticated → AuthModal)
