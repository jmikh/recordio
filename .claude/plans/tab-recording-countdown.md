# Tab Recording Countdown

## Context

Currently, when a user clicks "Start Recording" in the popup for tab mode, recording begins immediately with no warning. The request is to add a 3-second countdown timer displayed as an overlay on the tab being recorded, giving the user time to prepare and a chance to cancel before recording actually starts.

---

## Flow

```
User clicks "Start Recording" in popup
  → Popup sends POPUP_START_TAB_RECORDING to background (unchanged)
  → Background gets active tab ID
  → Background sends BACKGROUND_CONTENT_SHOW_COUNTDOWN to content script
  → Content script injects countdown overlay (3 → 2 → 1)
      - User clicks Cancel → CONTENT_COUNTDOWN_CANCELLED → background returns early
      - Timer hits 0      → CONTENT_COUNTDOWN_COMPLETE  → background proceeds with existing recording flow
```

---

## Implementation

### 1. `extension/src/shared/messageTypes.ts`

Add 4 new message type constants:

```ts
BACKGROUND_CONTENT_SHOW_COUNTDOWN: 'BACKGROUND_CONTENT_SHOW_COUNTDOWN',
BACKGROUND_CONTENT_HIDE_COUNTDOWN: 'BACKGROUND_CONTENT_HIDE_COUNTDOWN', // for future use / cancellation from popup side
CONTENT_COUNTDOWN_COMPLETE:        'CONTENT_COUNTDOWN_COMPLETE',
CONTENT_COUNTDOWN_CANCELLED:       'CONTENT_COUNTDOWN_CANCELLED',
```

---

### 2. `extension/src/content/countdownOverlay.ts` *(new file)*

Vanilla DOM/CSS module — no React (content script is vanilla TS).

Responsibilities:
- `showCountdown(onComplete: () => void, onCancel: () => void): () => void`
  - Injects a fixed-position overlay into `document.body`
  - Shows large countdown number starting at 3, ticking every second
  - Shows "Cancel" button below the number
  - When count reaches 0: removes overlay, calls `onComplete()`
  - When Cancel clicked: removes overlay, calls `onCancel()`
  - Returns a `cleanup` function (removes overlay + clears timers)

**Overlay design:**
- Dark semi-transparent pill/card centered in viewport (`position: fixed`, z-index `2147483646` — same as existing debug overlays)
- Large countdown digit with CSS animation (scale pop per tick)
- "Cancel" button below in a muted style
- No dependency on the page's CSS (all inline styles)

---

### 3. `extension/src/content/content.ts`

Add message handler cases for:

- `BACKGROUND_CONTENT_SHOW_COUNTDOWN`: call `showCountdown(...)`, on complete/cancel send `CONTENT_COUNTDOWN_COMPLETE` or `CONTENT_COUNTDOWN_CANCELLED` to background via `chrome.runtime.sendMessage`
- `BACKGROUND_CONTENT_HIDE_COUNTDOWN`: call the cleanup function returned by `showCountdown` (removes overlay early if background needs to abort)

Store the cleanup reference so it can be called if `BACKGROUND_CONTENT_HIDE_COUNTDOWN` arrives.

---

### 4. `extension/src/background/background.ts`

Modify the `POPUP_START_TAB_RECORDING` handler. After getting the active tab, insert a countdown wait before the existing recording flow:

```ts
// After getting activeTab:

// 1. Tell content script to show countdown
chrome.tabs.sendMessage(activeTab.id, {
  type: MSG_TYPES.BACKGROUND_CONTENT_SHOW_COUNTDOWN,
});

// 2. Wait for result (one-time Promise-based listener)
const started = await waitForCountdownResult();
if (!started) return; // user cancelled

// 3. Continue with existing flow:
//    getMediaStreamId, getTabDimensions, ensureOffscreenDocument, BACKGROUND_OFFSCREEN_INIT, saveState...
```

**`waitForCountdownResult()`** — a helper that wraps a one-time `chrome.runtime.onMessage` listener in a Promise:
```ts
function waitForCountdownResult(): Promise<boolean> {
  return new Promise((resolve) => {
    const handler = (message: any) => {
      if (message.type === MSG_TYPES.CONTENT_COUNTDOWN_COMPLETE) {
        chrome.runtime.onMessage.removeListener(handler);
        resolve(true);
      } else if (message.type === MSG_TYPES.CONTENT_COUNTDOWN_CANCELLED) {
        chrome.runtime.onMessage.removeListener(handler);
        resolve(false);
      }
    };
    chrome.runtime.onMessage.addListener(handler);
  });
}
```

---

## Files to Modify

| File | Change |
|------|--------|
| `extension/src/shared/messageTypes.ts` | Add 4 new message type constants |
| `extension/src/content/content.ts` | Handle `SHOW_COUNTDOWN` and `HIDE_COUNTDOWN` messages |
| `extension/src/background/background.ts` | Insert countdown await in `POPUP_START_TAB_RECORDING` handler |

## File to Create

| File | Purpose |
|------|---------|
| `extension/src/content/countdownOverlay.ts` | Vanilla DOM countdown overlay widget |

---

## Verification

1. Build with `npm run build:extension:dev`
2. Load unpacked extension in Chrome
3. Open any tab, click the extension popup → "Start Recording"
4. **Verify:** Overlay appears in the tab with "3", counts down to "1", then recording starts
5. **Verify Cancel:** Click "Cancel" during countdown → overlay disappears, recording does NOT start, popup stays/reopens normally
6. **Verify Tab Mode only:** Desktop/window recording via controller tab is unaffected
