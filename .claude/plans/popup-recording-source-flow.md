# Popup-First Recording Source Flow

## Context

Currently window/desktop recording opens a controller tab with full UI (source picker, mic/camera config, start button). The new design centralises everything in the popup:

1. Popup gains a **source dropdown** (Current tab / Window / Desktop) replacing the static "Current tab" display and the separate "Record Window or Desktop" ghost button.
2. When Window or Desktop is chosen, the controller tab opens and immediately fires the OS source picker.
3. After the user picks a source, the controller holds the stream and sends a message to background; background switches focus back to the original tab and tries to reopen the popup.
4. The popup shows a "source ready" state — the user configures mic/camera and clicks Start Recording.
5. Countdown runs on the original tab (same as tab mode), then background tells the controller to start recording.
6. The controller becomes a **dumb surface**: it holds the stream and recording engine, has no interactive setup UI, and all controls remain in the popup.

---

## Files to Modify

| File | What Changes |
|------|-------------|
| `extension/src/shared/messageTypes.ts` | New message types + new fields on `RecordingState` |
| `extension/src/background/background.ts` | New message handlers, updated state, badge indicator |
| `extension/src/controller/ControllerApp.tsx` | Remove setup UI; immediate source pick; wait-then-start flow |
| `extension/src/popup/PreRecordingView.tsx` | Source dropdown; pending-source state UI; updated start handler |
| `extension/src/popup/PopupApp.tsx` | Load/react to `pendingControllerReady` state; update render branch |

---

## Step 1 — `messageTypes.ts`

### Add to `MSG_TYPES`
```typescript
POPUP_OPEN_SOURCE_PICKER: 'POPUP_OPEN_SOURCE_PICKER',        // popup → bg: open controller for source selection
POPUP_START_CONTROLLER_RECORDING: 'POPUP_START_CONTROLLER_RECORDING', // popup → bg: user clicked Start in popup (controller mode)
CONTROLLER_SOURCE_SELECTED: 'CONTROLLER_SOURCE_SELECTED',    // controller → bg: source picked, stream ready
BACKGROUND_CONTROLLER_START_RECORDING: 'BACKGROUND_CONTROLLER_START_RECORDING', // bg → controller: start now
```
Keep `POPUP_OPEN_CONTROLLER` as-is (referenced by external bridge handlers).

### Extend `RecordingState`
```typescript
pendingControllerReady: boolean;           // source selected, waiting for popup Start click
pendingCaptureType: 'another_window' | 'desktop' | null;
pendingSourceName: string | null;
```

---

## Step 2 — `background.ts`

### Update `DEFAULT_STATE`
Add the three new pending fields with falsy defaults.

### Handler: `POPUP_OPEN_SOURCE_PICKER`
Almost identical to the existing `POPUP_OPEN_CONTROLLER` handler (lines 639–657):
1. Guard: return error if `isRecording`.
2. Close any existing controller tab.
3. Query active tab → store as `originalTabId`.
4. Call `openControllerTab()`.
5. `saveState({ controllerTabId, originalTabId })` — do **not** set `isRecording` yet.
6. Respond `{ success: true }` immediately.

### Handler: `CONTROLLER_SOURCE_SELECTED` (payload: `{captureType, sourceName}`)
1. `saveState({ pendingControllerReady: true, pendingCaptureType, pendingSourceName })`.
2. `chrome.tabs.update(currentState.originalTabId!, { active: true })`.
3. `(chrome.action as any).openPopup?.().catch(() => {})`.
4. Set a "ready" badge indicator: `chrome.action.setBadgeText({ text: '●' })` with green background color, so user sees the icon if openPopup fails.

### Handler: `POPUP_START_CONTROLLER_RECORDING` (payload: `{hasAudio, audioDeviceId?, hasCamera, videoDeviceId?}`)
1. Guard: return error if `!pendingControllerReady || !controllerTabId`.
2. Respond `{ success: true }` immediately (popup can close while countdown runs).
3. Run countdown asynchronously: `waitForCountdownResult(currentState.originalTabId!)`.
4. If countdown cancelled:
   - Send `BACKGROUND_CONTROLLER_CANCEL` to controller tab to release the stream.
   - `saveState({ pendingControllerReady: false, pendingCaptureType: null, pendingSourceName: null })`.
   - Clear the ready badge.
5. If countdown completes:
   - `const sessionId = crypto.randomUUID()`.
   - Send `BACKGROUND_CONTROLLER_START_RECORDING` to controller tab: `{ hasAudio, audioDeviceId, hasCamera, videoDeviceId, sessionId }`.
   - `saveState({ currentSessionId: sessionId, pendingControllerReady: false, pendingCaptureType: null, pendingSourceName: null })`.
   - Clear the ready badge.
   - *(Don't set `isRecording: true` here — let the existing `CONTROLLER_STARTED_RECORDING` handler do it as before, preserving the confirmation handshake and badge timer start.)*

### Update `tabs.onRemoved` listener
In the `isControllerTab && !isRecording` branch, also clear pending state:
```typescript
saveState({ controllerTabId: null, pendingControllerReady: false, pendingCaptureType: null, pendingSourceName: null });
```
Also clear the ready badge in this branch: `chrome.action.setBadgeText({ text: '' })`.

---

## Step 3 — `ControllerApp.tsx`

### New phases
```typescript
type ControllerPhase = 'picking' | 'waiting' | 'recording';
// Remove 'setup'
```

### On mount: immediate source pick
Replace the current "wait for user to click Choose Source" with an automatic call. After `originalTabId` and prefs are loaded (the existing `useEffect`), call `chooseSource()` directly — no button needed.

### Refactor `chooseSource()`
- Keep: `chrome.desktopCapture.chooseDesktopMedia(sources, currentTab, callback)` + `getUserMedia` to get `displayStream`.
- **Add**: store `displayStream` in `displayStreamRef` (a `useRef`, not state).
- **Add**: detect `captureType` from `displaySurface` (same logic as today, lines ~265–271).
- **Add**: send `CONTROLLER_SOURCE_SELECTED` to background with `{ captureType, sourceName }`.
- **Change**: transition `phase` to `'waiting'` instead of starting recording.
- **Remove**: `VideoRecorder` creation, `recorder.prepare()`, state updates for camera/mic — these move to `startRecording`.
- Cancel path (empty `streamId`): call `window.close()`. The `tabs.onRemoved` handler in background cleans up state.

### Track-ended handler (Stop Sharing button)
```typescript
displayStreamRef.current.getVideoTracks()[0].onended = () => {
    if (phase !== 'recording') {
        window.close(); // triggers tabs.onRemoved cleanup
    } else {
        stopRecording(); // existing behaviour
    }
};
```

### New message: `BACKGROUND_CONTROLLER_START_RECORDING`
Add to the existing `chrome.runtime.onMessage` listener:
```typescript
case MSG_TYPES.BACKGROUND_CONTROLLER_START_RECORDING: {
    const { hasAudio, audioDeviceId, hasCamera, videoDeviceId, sessionId } = message.payload;
    await startRecording({ hasAudio, audioDeviceId, hasCamera, videoDeviceId, sessionId });
    break;
}
```

### Refactor `startRecording(config)`
New signature — config comes from the message, not component state:
```typescript
async function startRecording(config: {
    hasAudio: boolean; audioDeviceId?: string;
    hasCamera: boolean; videoDeviceId?: string;
    sessionId: string;
})
```
Steps:
1. Get `displayStream` from `displayStreamRef.current`.
2. Open mic/camera streams with `getUserMedia` using config device IDs.
3. Create `VideoRecorder(config.sessionId, { displayStream, hasAudio, hasCamera, ... })`.
4. `await recorder.prepare(...)` → get `detectionResult`.
5. If `detectionResult.isControllerWindow`: `chrome.tabs.update(originalTabIdRef.current, { active: true })` + 150ms delay (existing logic).
6. `await recorder.start(tabTitle)`.
7. Send `CONTROLLER_STARTED_RECORDING` (existing message, existing handler in background sets `isRecording: true` and starts badge timer).
8. Set `phase('recording')`.

### Remove from ControllerApp
- All setup phase JSX (MicrophoneCard, CameraCard, ScreenShareCard, Start button, tab switcher, permission modal).
- State: `micDevices`, `camDevices`, `activeTab`, `showPermissionModal`, `isAudioEnabled`, `isVideoEnabled`, `selectedAudioId`, `selectedVideoId`, `cameraDeviceError`, `micDeviceError`.
- Prefs load/save `useEffect` (popup owns prefs now).

### Render
- `picking`: minimal UI ("Choosing source…" or just the extension logo).
- `waiting`: minimal UI ("Source selected — configure recording in the popup").
- `recording`: existing `RecordingPhase` component unchanged (user still has fallback controls here).

---

## Step 4 — `PreRecordingView.tsx`

### New props
```typescript
interface PreRecordingViewProps {
    pendingState?: RecordingState; // present when pendingControllerReady is true
}
export function PreRecordingView({ pendingState }: PreRecordingViewProps)
```

### New state
```typescript
const [sourceType, setSourceType] = useState<'tab' | 'window' | 'desktop'>('tab');
```

### Replace screen row (lines 339–345) and "Record Window or Desktop" button (lines 385–392)

**New screen row** — with inline source dropdown:
```jsx
<div className="flex items-center gap-3 px-3 py-2.5 rounded-[var(--radius-md)] border border-border bg-surface">
    <MdComputer className="icon-md text-text-muted" />
    <span className="text-sm font-medium text-text-main">Screen</span>
    <div className="flex-1" />
    {pendingState?.pendingControllerReady ? (
        // Show locked selected source + change link
        <>
            <span className="text-xs text-text-muted">
                {pendingState.pendingCaptureType === 'desktop' ? 'Desktop' : 'Window'} selected
            </span>
            <span
                className="text-xs text-primary underline cursor-pointer ml-2"
                onClick={() => handleOpenSourcePicker(sourceType as 'window' | 'desktop')}
            >
                Change
            </span>
        </>
    ) : (
        <Dropdown
            options={[
                { value: 'tab', label: 'Current tab' },
                { value: 'window', label: 'Window' },
                { value: 'desktop', label: 'Desktop' },
            ]}
            value={sourceType}
            onChange={(val) => {
                setSourceType(val as 'tab' | 'window' | 'desktop');
                if (val === 'window' || val === 'desktop') {
                    handleOpenSourcePicker(val);
                }
            }}
        />
    )}
</div>
```
Remove the separate ghost "Record Window or Desktop" button entirely.

### New handler `handleOpenSourcePicker`
```typescript
const handleOpenSourcePicker = async (type: 'window' | 'desktop') => {
    stopAllPreviews();
    await chrome.runtime.sendMessage({ type: MSG_TYPES.POPUP_OPEN_SOURCE_PICKER });
    window.close();
};
```

### Update `handleStartRecording`
```typescript
if (pendingState?.pendingControllerReady) {
    // Controller mode
    const resp = await chrome.runtime.sendMessage({
        type: MSG_TYPES.POPUP_START_CONTROLLER_RECORDING,
        payload: { hasAudio: micEnabled, audioDeviceId: selectedMicId || undefined, hasCamera: camEnabled, videoDeviceId: selectedCamId || undefined },
    });
    if (!resp?.success) { setError(resp?.error || 'Failed to start'); setStarting(false); }
    else { window.close(); }
} else {
    // Existing tab mode path — unchanged
}
```

### Update Start button disabled condition
```typescript
disabled={starting || (!pendingState?.pendingControllerReady && !canRecordTab)}
```

---

## Step 5 — `PopupApp.tsx`

### Load pending state on mount
In the existing `useEffect` (lines 27–58), after checking `state?.isRecording`, also check `state?.pendingControllerReady`:
```typescript
if (state?.pendingControllerReady) {
    setPendingState(state); // new state var
}
```

### Add `pendingState` state
```typescript
const [pendingState, setPendingState] = useState<RecordingState | null>(null);
```

### Make storage listener unconditional
Remove the `if (!recordingState) return;` guard on the storage listener `useEffect`. Replace the dependency with `[]` (always active), and in the listener update both `recordingState` and `pendingState` from the new storage value:
```typescript
useEffect(() => {
    const listener = (changes, area) => {
        if (area !== 'session' || !changes[STORAGE_KEYS.RECORDING_STATE]) return;
        const state = changes[STORAGE_KEYS.RECORDING_STATE].newValue as RecordingState ?? null;
        if (state?.isRecording) setRecordingState(state);
        else setRecordingState(null);
        if (state?.pendingControllerReady) setPendingState(state);
        else setPendingState(null);
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
}, []);
```

### Update render branch
```typescript
} : recordingState ? (
    <RecordingView recordingState={recordingState} />
) : (
    <PreRecordingView pendingState={pendingState ?? undefined} />
)}
```
`PreRecordingView` handles both the normal (no pending) and pending-source states via its prop.

---

## Edge Cases

| Scenario | Handling |
|----------|---------|
| User cancels OS picker | Controller calls `window.close()`. `tabs.onRemoved` clears all pending state + badge. |
| User closes controller before picking | Same `tabs.onRemoved` path. |
| `openPopup()` fails | Badge `●` indicator tells user to click the extension icon. Popup reads pending state from storage on open. |
| Stop Sharing button before Start | Track `onended` fires while `phase === 'waiting'` → `window.close()` → cleanup. |
| User changes source (clicks Change) | Re-calls `handleOpenSourcePicker` which sends `POPUP_OPEN_SOURCE_PICKER` again. Background closes old controller, opens new one. |
| Tab recording unchanged | `POPUP_START_TAB_RECORDING` path is completely unchanged. |

---

## Verification

1. **Tab recording** — unchanged: select "Current tab" (default), start recording, confirm countdown + badge appear.
2. **Window source flow** — select "Window", popup closes, controller opens, OS picker shows immediately. Pick a window. Confirm badge shows `●`, original tab regains focus, popup reopens with "Window selected" and active Start button.
3. **Desktop source flow** — same as above with "Desktop".
4. **OS picker cancelled** — cancel in picker, confirm controller closes, badge clears, state resets.
5. **`openPopup()` fails fallback** — after source selection, if popup doesn't auto-open, badge shows `●`. Manually click extension icon → popup shows pending state correctly.
6. **Start Recording (controller mode)** — configure mic/camera, click Start, countdown on original tab, recording starts through controller, badge switches to timer.
7. **Cancel countdown** — during countdown click Cancel → controller stream released, controller closes, state resets.
8. **Stop Sharing before Start** — click Chrome's "Stop Sharing" bar while in `waiting` phase → controller closes, state resets cleanly.
9. **Pause/Resume/Finish/Cancel from popup** — all still work via existing message routing through background.
10. **Pending state badge clear** — after recording starts, badge switches from `●` to the elapsed timer.
