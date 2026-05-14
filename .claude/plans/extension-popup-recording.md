# Extension Popup Recording UX

## Context

Currently, clicking the extension icon opens a full controller tab where the user configures and manages recording. This gives no visual feedback about what's being recorded, and for simple tab recording it's overkill. The new design replaces the icon-click behavior with a proper browser popup that handles tab recording inline, while the controller tab is retained for window/desktop recording.

At any time only one recording can be running. The mid-recording popup controls (pause/resume/cancel/finish) work regardless of whether the active recording is a tab recording (offscreen doc) or a window/desktop recording (controller tab). The background routes commands to whichever is active.

## Goals

1. Clicking the extension icon opens a small popup (not a new tab)
2. Pre-recording popup: mic toggle with audio level preview, camera toggle with live video preview, screen label "Current Tab" (no preview); button to open controller for window/desktop
3. Mid-recording popup: pause/resume, cancel, finish — works for both tab mode and controller mode
4. Tab recording runs in an offscreen document (no controller tab needed)
5. Controller tab kept as-is; invoked from the popup for window/desktop

---

## Message Flow

All messages use `chrome.runtime.sendMessage` unless noted. Background is the single source of truth for recording state. Each message name is prefixed by its sender for clarity.

```
POPUP → BACKGROUND  (chrome.runtime.sendMessage)
  POPUP_START_TAB_RECORDING   { hasAudio, audioDeviceId, hasVideo, videoDeviceId }
  POPUP_OPEN_CONTROLLER       {}
  POPUP_PAUSE_RECORDING       {}
  POPUP_RESUME_RECORDING      {}
  POPUP_CANCEL_RECORDING      {}
  POPUP_FINISH_RECORDING      {}

BACKGROUND → OFFSCREEN  (chrome.runtime.sendMessage)
  BACKGROUND_OFFSCREEN_INIT   { tabStreamId, hasAudio, audioDeviceId, hasVideo, videoDeviceId, sessionId }
  BACKGROUND_OFFSCREEN_PAUSE  {}
  BACKGROUND_OFFSCREEN_RESUME {}
  BACKGROUND_OFFSCREEN_CANCEL {}
  BACKGROUND_OFFSCREEN_FINISH {}

OFFSCREEN → BACKGROUND  (chrome.runtime.sendMessage)
  OFFSCREEN_DONE              { cancelled: boolean, projectId?: string, blobIds?: {...} }

BACKGROUND → CONTROLLER TAB  (chrome.tabs.sendMessage to controllerTabId)
  STOP_SESSION                        {}   (existing — reused for FINISH)
  BACKGROUND_CONTROLLER_PAUSE         {}   (new)
  BACKGROUND_CONTROLLER_RESUME        {}   (new)
  BACKGROUND_CONTROLLER_CANCEL        {}   (new — controller discards and closes)

CONTROLLER → BACKGROUND  (existing, unchanged)
  CONTROLLER_STARTED_RECORDING  { ... }
  CONTROLLER_STOPPED_RECORDING  { ... }
```

**Routing rule in background** — on pause/resume/cancel/finish, check `recordingState.recordingMode`:
- `'tab'` → send `BACKGROUND_OFFSCREEN_*` via `chrome.runtime.sendMessage`
- `'controller'` → send `BACKGROUND_CONTROLLER_*` via `chrome.tabs.sendMessage(controllerTabId, ...)`

---

## Cleanup & Mutual Exclusion

### Guard: prevent double-start
Before processing `POPUP_START_TAB_RECORDING`, background checks `recordingState.isRecording`. If `true`, it returns an error response; popup shows an alert. Same guard for `POPUP_OPEN_CONTROLLER`. Only one recording runs at a time.

### Cleanup sequences

**Tab recording cancel** (`POPUP_CANCEL_RECORDING`, mode `'tab'`):
1. Background sends `BACKGROUND_OFFSCREEN_CANCEL` to offscreen
2. Offscreen stops all MediaStream tracks, aborts VideoRecorder, deletes any partial blobs from IndexedDB
3. Offscreen responds `OFFSCREEN_DONE { cancelled: true }`
4. Background calls `chrome.offscreen.closeDocument()`
5. Background resets `RecordingState` to defaults
6. Background clears badge timer interval and resets badge

**Tab recording finish** (`POPUP_FINISH_RECORDING`, mode `'tab'`):
1. Background sends `BACKGROUND_OFFSCREEN_FINISH`
2. Offscreen finalizes VideoRecorder, saves blobs to IndexedDB
3. Offscreen responds `OFFSCREEN_DONE { projectId, blobIds }`
4. Background calls `chrome.offscreen.closeDocument()`
5. Background clears state + badge
6. Background opens import page (existing logic)

**Controller cancel** (`POPUP_CANCEL_RECORDING`, mode `'controller'`):
1. Background sends `BACKGROUND_CONTROLLER_CANCEL` to controller tab
2. Controller stops all streams, deletes partial blobs from IndexedDB, closes its own tab
3. Background clears state + badge on `CONTROLLER_STOPPED_RECORDING` or tab close

**Popup preview stream cleanup** (three places):
- Toggle-off handler: immediately stops tracks for that device
- `useEffect` cleanup (component unmount / popup closed): stops all active preview tracks
- Immediately before sending `POPUP_START_TAB_RECORDING` or `POPUP_OPEN_CONTROLLER`: stop all preview tracks before handing off to recording

---

## Implementation Plan

### Step 1: Add new message types
**File**: `extension/src/shared/messageTypes.ts`

Add all sender-prefixed constants listed in the Message Flow section. Each gets a one-line JSDoc comment showing direction and payload shape. Keep existing constants unchanged.

### Step 2: Update manifest.json
**File**: `extension/manifest.json`

- Add `"default_popup": "src/popup/popup.html"` under `action`
- Add `"offscreen"` to `permissions`
- `tabCapture` already present — keep it

### Step 3: Update background.ts
**File**: `extension/src/background/background.ts`

- Remove `chrome.action.onClicked` handler (popup replaces it)
- Add `chrome.runtime.onMessage` cases for all `POPUP_*` messages:
  - `POPUP_START_TAB_RECORDING`: guard check → `chrome.tabCapture.getMediaStreamId()` → `chrome.offscreen.createDocument()` → send `BACKGROUND_OFFSCREEN_INIT` → set state `{ isRecording: true, recordingMode: 'tab', isPaused: false }` → start badge timer
  - `POPUP_OPEN_CONTROLLER`: guard check → call existing `openControllerTab()` (state set to `'controller'` when `CONTROLLER_STARTED_RECORDING` arrives)
  - `POPUP_PAUSE_RECORDING`: route to offscreen or controller → set `isPaused: true` → pause badge timer
  - `POPUP_RESUME_RECORDING`: reverse → set `isPaused: false` → resume badge timer
  - `POPUP_CANCEL_RECORDING`: run cancel cleanup sequence above
  - `POPUP_FINISH_RECORDING`: run finish cleanup sequence above
  - `OFFSCREEN_DONE`: handle completion (open import page if not cancelled, close offscreen, clear state)

Extend `RecordingState`:
```typescript
isPaused: boolean;
recordingMode: 'tab' | 'controller' | null;
```

### Step 4: Create offscreen document
**Files**: `extension/src/offscreen/offscreen.html`, `extension/src/offscreen/offscreen.ts`

- `BACKGROUND_OFFSCREEN_INIT`: get tab stream via `getUserMedia({ video: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: tabStreamId } } })`, get mic via `getUserMedia({ audio: { deviceId } })` if `hasAudio`, get camera via `getUserMedia({ video: { deviceId } })` if `hasVideo`. Create and start `VideoRecorder`.
- `BACKGROUND_OFFSCREEN_PAUSE` / `RESUME`: call `videoRecorder.pause()` / `resume()`
- `BACKGROUND_OFFSCREEN_CANCEL`: stop all tracks, abort recorder, delete partial blobs from IndexedDB, send `OFFSCREEN_DONE { cancelled: true }`
- `BACKGROUND_OFFSCREEN_FINISH`: `videoRecorder.finish()`, send `OFFSCREEN_DONE { projectId, blobIds }`

### Step 5: Add pause/resume to VideoRecorder
**File**: `extension/src/shared/videoRecorder.ts`

- `pause()`: pause mic/camera `MediaRecorder` instances, record `pauseStartTime = Date.now()`
- `resume()`: resume `MediaRecorder` instances, accumulate `totalPausedMs += Date.now() - pauseStartTime`
- Elapsed time reported by VideoRecorder should subtract `totalPausedMs`

### Step 6: Add pause/resume/cancel to ControllerApp
**File**: `extension/src/controller/ControllerApp.tsx`

Add `chrome.runtime.onMessage` handlers for three new messages:
- `BACKGROUND_CONTROLLER_PAUSE`: call `videoRecorder.pause()`
- `BACKGROUND_CONTROLLER_RESUME`: call `videoRecorder.resume()`
- `BACKGROUND_CONTROLLER_CANCEL`: stop all streams, delete partial blobs from IndexedDB, call `window.close()`

This is the minimal change to controller code.

### Step 7: Create popup
**Files**: `extension/src/popup/popup.html`, `extension/src/popup/main.tsx`, `extension/src/popup/PopupApp.tsx`, `extension/src/popup/PreRecordingView.tsx`, `extension/src/popup/RecordingView.tsx`

**PopupApp.tsx**: On mount, read `chrome.storage.session` for `recordingState.isRecording`. Render `PreRecordingView` or `RecordingView` accordingly. Subscribe to `chrome.storage.onChanged` to switch views if recording starts/stops while popup is open.

**PreRecordingView.tsx**:
- Mic row: toggle + device `<select>` (from `navigator.mediaDevices.enumerateDevices()`). On toggle-on: open `getUserMedia({ audio: { deviceId } })` → feed into `AnalyserNode` → render compact audio level bar (adapt pattern from `MicrophoneCard.tsx`). Toggle-off: `track.stop()`.
- Camera row: toggle + device `<select>`. On toggle-on: open `getUserMedia({ video: { deviceId } })` → display in small `<video autoPlay muted>`. Toggle-off: `track.stop()`.
- Screen: static label "Current Tab"
- "Start Recording" button: stop all preview tracks → send `POPUP_START_TAB_RECORDING`
- "Record Window or Desktop →" button: stop all preview tracks → send `POPUP_OPEN_CONTROLLER` → `window.close()`
- Cleanup: `useEffect` return + `window.addEventListener('beforeunload', ...)` both call `track.stop()` on all active preview tracks

**RecordingView.tsx**:
- Read `recordingState` from `chrome.storage.session` on mount; use `chrome.storage.onChanged` for live updates
- Compute elapsed from `startTime` minus `totalPausedMs`; update every second via `setInterval` (clear on unmount)
- Show source label: "Recording current tab" if `recordingMode === 'tab'`, else "Recording window/desktop"
- Pause/Resume button: send `POPUP_PAUSE_RECORDING` or `POPUP_RESUME_RECORDING`
- Cancel button: show `window.confirm(...)` → if confirmed, send `POPUP_CANCEL_RECORDING`
- Finish button (primary): send `POPUP_FINISH_RECORDING`

### Step 8: Build config
**File**: `extension/vite.config.ts`

Add `popup` and `offscreen` as additional Rollup `input` entry points alongside the existing `controller` entry.

---

## Critical Files

| File | Role |
|------|------|
| `extension/manifest.json` | Add popup action + offscreen permission |
| `extension/src/background/background.ts` | Unified routing, tabCapture, offscreen lifecycle, cleanup |
| `extension/src/shared/messageTypes.ts` | All new sender-prefixed message constants |
| `extension/src/shared/videoRecorder.ts` | Add pause/resume with elapsed-time accounting |
| `extension/src/controller/ControllerApp.tsx` | Handle PAUSE / RESUME / CANCEL from background |
| `extension/src/popup/PopupApp.tsx` + siblings | New popup UI (pre-recording + mid-recording) |
| `extension/src/offscreen/offscreen.ts` | New offscreen recorder host |
| `extension/vite.config.ts` | Add popup + offscreen entry points |

---

## What is NOT changed

- Controller tab setup flow (screen source picker, effects, window detection)
- Event capture content scripts
- `projectStorage.ts`
- Import page / website integration

---

## Verification

1. Load unpacked extension → click icon → popup appears (not a new tab)
2. Toggle mic on → audio level bar animates; toggle off → bar stops and track is released
3. Toggle camera on → live preview appears; toggle off → track released
4. Click "Start Recording" → all preview tracks stopped first, then popup shows RecordingView with timer
5. Click icon mid-tab-recording → RecordingView with pause/resume/cancel/finish
6. Pause → timer freezes, badge pauses; Resume → both continue
7. Finish → import page opens, offscreen closed, state cleared
8. Cancel → state cleared, partial blobs deleted, nothing saved
9. "Record Window or Desktop →" → preview tracks stopped, controller tab opens, popup closes
10. Mid-controller-recording → click icon → same RecordingView; pause/resume/cancel/finish routed to controller tab
