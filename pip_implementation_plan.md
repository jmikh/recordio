# Camera Float Window — Implementation Plan

## Goal

Show a floating, **always-on-top** camera preview during recording so users can see themselves. Uses Document Picture-in-Picture API backed by a `chrome.windows.create` window.

**Capture behavior:**
| Mode | PiP Captured? | Notes |
|---|---|---|
| Tab | ❌ No | Tab capture only records DOM |
| Window | ❌ No | Only the selected window is captured |
| Screen | ✅ Yes | User can move PiP to another monitor |

---

## Architecture

```
Popup (CameraPreview.tsx)
  │  User clicks "Float" button
  │
  ▼
Background (background.ts)
  │  chrome.windows.create({ type: 'popup' })
  │  Opens camera-float.html?deviceId=xxx&mode=tab
  │
  ▼
Camera Float Window (camera-float.html)
  │  Shows camera preview + "Pin on top" button
  │  User clicks "Pin on top"
  │
  ▼
Document PiP Window (always-on-top)
  │  Camera feed in a floating, always-on-top window
  │  Backing window auto-minimizes
  │
  ▼
Recording starts/stops
  │  Background closes backing window → PiP closes too
```

---

## Proposed Changes

### New Files

#### [NEW] [camera-float.html](file:///Users/johnmikhail/Projects/recordio-all/recordio/extension/src/camera-float/camera-float.html)

Extension page for the backing window:
- Camera `<video>` preview (mirrored)
- **"Pin on top"** button → calls `documentPictureInPicture.requestWindow()`
- After PiP opens, backing window auto-minimizes via `chrome.windows.update(windowId, { state: 'minimized' })`
- Screen-mode warning: *"Move to another screen — may appear in your recording"*

#### [NEW] [camera-float.ts](file:///Users/johnmikhail/Projects/recordio-all/recordio/extension/src/camera-float/camera-float.ts)

Script logic:
- Parse URL params: `deviceId`, `mode`
- Acquire camera stream: `getUserMedia({ video: { deviceId: { exact: deviceId } } })`
- Attach to `<video>` element
- On "Pin on top" click:
  ```ts
  const pipWindow = await documentPictureInPicture.requestWindow({
    width: 320,
    height: 240,
  });
  // Move video element into PiP window
  const video = document.querySelector('video');
  pipWindow.document.body.appendChild(video);
  // Style the PiP document (dark bg, rounded video, mirrored)
  // Auto-minimize backing window
  ```
- If `mode === 'screen'`, show warning banner in PiP
- Listen for PiP close → re-show video in backing window (user can re-pin)
- Listen for `CLOSE_CAMERA_FLOAT` message → stop stream, close window

---

### Modified Files

#### [MODIFY] [App.tsx](file:///Users/johnmikhail/Projects/recordio-all/recordio/extension/src/popup/App.tsx)

Add a **"Float"** button above the [CameraPreview](file:///Users/johnmikhail/Projects/recordio-all/recordio/extension/src/popup/components/CameraPreview.tsx#7-30) component (only visible when camera is enabled and stream is active):
```tsx
<button onClick={handleFloatCamera}>Float</button>
```

`handleFloatCamera`:
- Sends message to background: `{ type: MSG_TYPES.OPEN_CAMERA_FLOAT, payload: { deviceId: selectedVideoId, mode: recordingMode } }`
- Optionally stops the local popup camera stream (the float window acquires its own)

#### [MODIFY] [background.ts](file:///Users/johnmikhail/Projects/recordio-all/recordio/extension/src/background/background.ts)

**New message handler** `OPEN_CAMERA_FLOAT`:
```ts
async function openCameraFloat(deviceId: string, mode: RecorderMode): Promise<number | null> {
  const url = chrome.runtime.getURL(
    `src/camera-float/camera-float.html?deviceId=${deviceId}&mode=${mode}`
  );
  const win = await chrome.windows.create({
    url,
    type: 'popup',
    width: 400,
    height: 340,
    top: 60,
    left: screen.availWidth - 440,
    focused: true,
  });
  return win?.id ?? null;
}
```

**Track the float window** in `RecordingState.cameraFloatWindowId`.

**Close on recording stop** in [handleStopSession()](file:///Users/johnmikhail/Projects/recordio-all/recordio/extension/src/background/background.ts#539-624):
```ts
if (currentState?.cameraFloatWindowId) {
  chrome.windows.remove(currentState.cameraFloatWindowId).catch(() => {});
}
```

**Handle manual close** via `chrome.windows.onRemoved`:
- If removed window matches `cameraFloatWindowId`, clear from state (recording continues)

#### [MODIFY] [messageTypes.ts](file:///Users/johnmikhail/Projects/recordio-all/recordio/extension/src/shared/messageTypes.ts)

Add to `MSG_TYPES`:
```ts
OPEN_CAMERA_FLOAT: 'OPEN_CAMERA_FLOAT',
CLOSE_CAMERA_FLOAT: 'CLOSE_CAMERA_FLOAT',
```

Add to [RecordingState](file:///Users/johnmikhail/Projects/recordio-all/recordio/extension/src/shared/messageTypes.ts#67-78):
```ts
cameraFloatWindowId: number | null;
```

#### [MODIFY] [vite.config.ts](file:///Users/johnmikhail/Projects/recordio-all/recordio/extension/vite.config.ts)

Add entry point:
```diff
 input: {
     offscreen: resolve(__dirname, 'src/offscreen/offscreen.html'),
     controller: resolve(__dirname, 'src/controller/controller.html'),
+    cameraFloat: resolve(__dirname, 'src/camera-float/camera-float.html'),
 },
```

---

## Lifecycle

```
1. User enables camera in popup → sees preview
2. User clicks "Float" → background opens camera-float window
3. Camera-float window loads → shows camera + "Pin on top" button
4. User clicks "Pin on top" → Document PiP opens (always-on-top)
   → backing window auto-minimizes
5. User clicks "Start Recording" in popup → recording begins
   → PiP stays floating throughout recording
6. User stops recording → background closes backing window → PiP closes
```

**Float is independent of recording** — user can float before, during, or even without recording. The float button is always available when camera is on.

---

## Screen Mode Warning

In the PiP window (when `mode=screen`):

> 📍 Move to another screen — may appear in your recording

Small banner at top of the PiP content. Non-intrusive.

---

## Edge Cases

| Scenario | Behavior |
|---|---|
| User closes PiP manually | Video returns to backing window, user can re-pin |
| User closes backing window | PiP closes, `cameraFloatWindowId` cleared from state, recording continues |
| Recording stops | Background closes backing window → PiP closes |
| User clicks Float again while already floating | Focus existing window instead of opening new one |
| No camera enabled | Float button hidden |
| Service worker restarts | `cameraFloatWindowId` in session storage may be stale — validate on wake |

---

## Verification

1. **Tab mode**: Float camera → pin → start recording → verify PiP not in exported video
2. **Window mode**: Same — verify PiP not captured in the selected window
3. **Screen mode**: Verify warning banner shows, PiP visible in recording
4. **Manual close**: Close PiP → verify video returns to backing window
5. **Stop recording**: Verify backing window + PiP both close
6. **Re-pin**: Close PiP → click "Pin" again in backing window → PiP re-opens
