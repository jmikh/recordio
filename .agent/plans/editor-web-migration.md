# Editor Web Migration Plan

> **Status**: 🟡 Planning Phase
> **Last Updated**: 2026-02-02
> **Consultation Rule**: Agent MUST consult user before starting each phase and at any decision point during implementation.

---

## Overview

Migrate from a monolithic Chrome extension to a **thin recorder extension + hosted editor website** architecture.

### Goals
1. **IP Protection**: Editor logic (zoom, spotlight, painters) can be obfuscated on the server
2. **Update Velocity**: Website changes deploy instantly without Chrome Store review
3. **Monetization Control**: Server-side subscription enforcement
4. **User Experience**: Recorder remains lightweight, editor is feature-rich

### Architecture

```
RECORDING PHASE
───────────────
┌─────────────────────────────────────────────────────────────────────────────┐
│  Extension (Chrome)                                                         │
│  ┌────────────────────┐    ┌────────────────────────────────────────────┐   │
│  │   Service Worker   │    │   Recording Logic                          │   │
│  │                    │    │   - popup/, content/, offscreen/           │   │
│  └─────────┬──────────┘    └────────────────────────────────────────────┘   │
│            │                                                                │
│            ▼                                                                │
│  ┌────────────────────┐                                                     │
│  │   Temp IndexedDB   │  ◄── Recording stops: opens website tab            │
│  │   (ephemeral)      │                                                     │
│  └────────────────────┘                                                     │
└─────────────────────────────────────────────────────────────────────────────┘

HANDOFF PHASE (one-time, after recording)
─────────────────────────────────────────
┌─────────────────────────────────────────────────────────────────────────────┐
│                          recordio.site/import?id={uuid}                     │
│  ┌─────────────────┐     window.postMessage      ┌───────────────────────┐  │
│  │   Website       │◄───────────────────────────►│  Bridge Script        │  │
│  │   (React)       │                             │  (content script)     │  │
│  │                 │                             └───────────┬───────────┘  │
│  │  1. Receive     │                                         │              │
│  │  2. Store       │                    chrome.runtime.sendMessage          │
│  │  3. Confirm     │                                         │              │
│  │  4. Redirect    │                                         ▼              │
│  └─────────────────┘                             ┌───────────────────────┐  │
│                                                  │ Extension Service     │  │
│                                                  │ Worker: sends data,   │  │
│                                                  │ then DELETES temp     │  │
│                                                  └───────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘

EDITING PHASE (no extension needed!)
────────────────────────────────────
┌─────────────────────────────────────────────────────────────────────────────┐
│                          recordio.site/editor/{projectId}                   │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │   React Editor (full featured)                                      │    │
│  │   - Loads from WEBSITE'S IndexedDB (permanent storage)              │    │
│  │   - No extension communication                                      │    │
│  │   - Works offline once loaded                                       │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Decisions Made

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Repo structure | **In-place split** | Simpler, faster to implement |
| Web framework | **Vite + React** | Same as extension, Cloudflare-compatible |
| Target domain | `recordio.site/editor` | User specified |
| Auth approach | **Keep as-is** (direct Supabase) | Defer auth changes |
| Hosting | **Local dev only** (this iteration) | Cloudflare later |
| Offline support | **Defer to Phase 5** (PWA) | Architecture supports it |

---

## Folder Structure (Target)

```
/recordio
├── src/
│   ├── extension/              # RECORDER ONLY (thin)
│   │   ├── recording/          # ← moved from src/recording
│   │   │   ├── background/
│   │   │   ├── content/
│   │   │   ├── controller/
│   │   │   ├── offscreen/
│   │   │   ├── popup/
│   │   │   └── shared/
│   │   ├── bridge/             # NEW: content script for editor domain
│   │   │   └── editorBridge.ts
│   │   └── storage/            # Simplified: RawRecordingStorage only
│   │       └── rawRecordingStorage.ts
│   │
│   ├── editor-web/             # EDITOR WEBSITE (rich)
│   │   ├── index.html          # Entry point
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   ├── editor/             # ← moved from src/editor
│   │   ├── core/               # ← moved from src/core (most of it)
│   │   ├── storage/            # Website's own projectStorage
│   │   ├── hooks/
│   │   │   └── useExtensionBridge.ts  # Communication with extension
│   │   └── pages/
│   │       ├── RecordingsPage.tsx     # List recordings from extension
│   │       └── EditorPage.tsx         # Main editor
│   │
│   └── shared/                 # SHARED CODE
│       ├── types/              # ← src/core/types.ts (split)
│       │   ├── core.ts         # Point, Rect, Size, etc.
│       │   ├── project.ts      # Project, Settings, etc.
│       │   ├── events.ts       # UserEvents, BaseEvent, etc.
│       │   └── index.ts
│       ├── components/         # ← src/components/ui
│       │   └── ui/
│       ├── theme/              # ← src/theme
│       └── styles/             # ← src/index.css (split into tokens)
│
├── public/                     # Extension assets (unchanged)
├── manifest.json               # Updated: remove editor, add bridge
├── vite.config.ts              # Extension build
├── vite.config.editor-web.ts   # NEW: Website build
└── package.json
```

---

## Phases

### Phase 1: Scaffolding
**Status**: ✅ Complete
**Completed**: 2026-02-02

#### Tasks
- [x] 1.1 Create folder structure (`src/extension`, `src/editor-web`, `src/shared`)
- [x] 1.2 Create `vite.config.editor-web.ts` for website build
- [x] 1.3 Create minimal `editor-web/index.html` and `main.tsx`
- [x] 1.4 Add npm scripts: `dev:extension`, `dev:editor-web`, `build:extension`, `build:editor-web`
- [x] 1.5 Verify extension still builds and runs
- [x] 1.6 Verify editor-web dev server starts (http://localhost:3001)

#### Notes
- Extension builds: 929 modules, outputs to `dist/`
- Editor-web serves on port 3001, outputs to `dist-editor-web/`
- Path aliases configured: `@`, `@shared`, `@editor-web`

---

### Phase 2: Extract Shared Code
**Status**: ✅ Complete
**Completed**: 2026-02-02

#### Tasks
- [x] 2.1 Move `src/core/types.ts` → `src/shared/types/` (split into modules: core, events, source, project, recording)
- [x] 2.2 Move `src/components/ui/` → `src/shared/components/ui/`
- [x] 2.3 Create re-export files for backwards compatibility
- [x] 2.4 Verify extension builds
- [x] 2.5 Verify editor-web builds

#### Notes & Lessons Learned
- **Re-export pattern works well**: `src/core/types.ts` now re-exports from `src/shared/types/` - zero import changes needed!
- **Not all components are truly shared**:
  - `DimmedOverlay` has editor-specific deps (displayMapper) → stays in `src/components/ui/`
  - `BugReportModal` has extension deps (chrome.runtime, sentry) → stays in `src/components/ui/`
- **Direct file imports needed shims**: Some code imported `../../../components/ui/Slider` instead of barrel. Created re-export shims.
- **Asset paths**: LogoLink had to update asset import path to `../../../assets/fulllogo.png`

#### Files Created
- `src/shared/types/core.ts` - ID, TimeMs, Point, Size, Rect
- `src/shared/types/events.ts` - EventType, BaseEvent, UserEvents, etc.
- `src/shared/types/source.ts` - SourceMetadata
- `src/shared/types/project.ts` - Project, Settings, Timeline, Actions
- `src/shared/types/recording.ts` - RawRecording (for Phase 3)
- `src/shared/types/index.ts` - Barrel export
- `src/shared/components/ui/` - 15 shared UI components

---

### Phase 3: Communication Bridge (Ephemeral Handoff)
**Status**: ✅ Complete
**Completed**: 2026-02-02

#### Key Insight: The Extension Copy is Ephemeral

The extension does NOT keep recordings. After recording finishes:
1. Extension opens website tab: `https://editor.recordio.site/import?id={uuid}`
2. One-time handoff via `externally_connectable` (direct messaging)
3. Website stores in ITS OWN IndexedDB (permanent storage)
4. Extension deletes its temporary copy
5. Future visits to website read from website's storage — no extension needed!

```
Recording Flow (Simplified - No Bridge Content Script!)
───────────────────────────────────────────────────────
  Extension: Records → Temp Storage
                          │
                          ▼ (opens new tab)
  Website:  /import?id={uuid}
                          │
                          ▼ (chrome.runtime.sendMessage via externally_connectable)
  Website:  Stores in IndexedDB (permanent)
                          │
                          ▼ (confirm)
  Extension: Deletes temp copy ✓
                          │
                          ▼
  Website:  Redirects to /editor/{projectId}
```

#### 3.1 RawRecording Type (already created in Phase 2)

```typescript
// src/shared/types/recording.ts (already exists!)
export interface RawRecording {
  id: string;                    // session-{uuid}
  createdAt: number;
  name: string;                  // Tab title or "Desktop"
  screenSource: SourceMetadata;  // Includes storageUrl (recordio-blob://)
  cameraSource?: SourceMetadata;
  userEvents: UserEvents;
}
```

#### 3.2 Simplified Architecture (Final)

**Key discovery:** Using `externally_connectable` + fixed `key` in manifest eliminates the need for a bridge content script!

**Manifest additions:**
```json
{
  "key": "MIIB...", // Fixed key ensures same extension ID always
  "externally_connectable": {
    "matches": ["http://localhost:3001/*", "https://editor.recordio.site/*"]
  }
}
```

**Direct communication (no bridge):**
```
Website ──► chrome.runtime.sendMessage(EXTENSION_ID, msg) ──► Service Worker
        ◄── response ◄──────────────────────────────────────┘
```

**Extension ID:** `koefgamknalpbomnfmkcmpkepcpjnapm` (derived from the key)

Only 3 messages needed:
```typescript
BRIDGE_MSG.BRIDGE_READY      // Website → Extension: "Give me recording {id}"
BRIDGE_MSG.HANDOFF_RECORDING // Extension → Website: RawRecording + blobs
BRIDGE_MSG.HANDOFF_COMPLETE  // Website → Extension: "Got it, delete temp copy"
```

#### 3.3 Tasks

- [x] 3.1 Create `src/shared/types/bridge.ts` with simplified message types
- [x] 3.2 Create `src/extension/storage/rawRecordingStorage.ts` (temp storage)
- [x] 3.3 Update recording flow: save as RawRecording
      - VideoRecorder still saves Project (backward compatible)
      - Background service worker converts Project→RawRecording after save
      - RawRecording saved to temp storage for website handoff
- [x] 3.4 Update service worker: after recording stops, open website tab with `?id=`
      - `handleStopSession` now calls `convertProjectToRawRecording`
      - Saves to temp storage via `saveRawRecording`
      - Opens website import page via `buildImportUrl`
      - Falls back to extension editor on error
- [x] 3.5 Add `externally_connectable` to manifest (no content script needed!)
- [x] 3.6 Add `key` to manifest for stable extension ID
- [x] 3.7 Add `onMessageExternal` handler in service worker for direct messaging
- [x] 3.8 Add handler in service worker for `BRIDGE_READY`:
      - Load recording from temp storage
      - Respond with `HANDOFF_RECORDING`
- [x] 3.9 Add handler in service worker for `HANDOFF_COMPLETE`:
      - Delete recording from temp storage
- [x] 3.10 Create `src/editor-web/hooks/useExtensionBridge.ts`:
      - Uses hardcoded extension ID (no bridge detection needed!)
      - Calls `chrome.runtime.sendMessage` directly
      - Includes retry logic for robustness
- [x] 3.11 Create `src/editor-web/storage/projectStorage.ts` (website's permanent storage)
- [x] 3.12 Create import page that orchestrates handoff
- [x] 3.13 Test end-to-end: Record → Tab opens → Handoff succeeds → Data in website IndexedDB ✅

#### Implementation Notes (Phase 3)

**Evolution of the approach:**
1. Initially planned: Content script bridge using postMessage relay
2. Problem: Timing issues with document_start, message listener not ready
3. Solution: `externally_connectable` allows website to call extension directly!
4. Bonus: Fixed `key` in manifest = stable extension ID = no detection needed

**Files created:**
- `src/shared/types/bridge.ts` - Message types and constants
- `src/extension/storage/rawRecordingStorage.ts` - Temp storage for handoff
- `src/editor-web/hooks/useExtensionBridge.ts` - Direct extension communication
- `src/editor-web/storage/projectStorage.ts` - Website's IndexedDB storage
- `src/editor-web/pages/ImportPage.tsx` - Handoff orchestration UI

**Files removed (simplified!):**
- `src/extension/bridge/editorBridge.ts` - Not needed with externally_connectable

#### Decision Points
- Should handoff timeout if website doesn't respond? (e.g., 30 seconds)
- What happens if user closes the tab before handoff completes?
  - Suggestion: Keep in temp storage, show in popup as "pending import"

---

### Phase 4: Project Listing & Editor Integration
**Status**: ✅ Complete
**Completed**: 2026-02-02

#### Key Point: No Extension Communication Needed

After import, all data is in the website's IndexedDB. The website works completely independently:

```
User visits recordio.site/editor
       │
       ▼
Website loads projects from ITS OWN IndexedDB
       │
       ▼
User edits, exports — all local
       │
       ▼
No extension needed! (it's just for recording + one-time handoff)
```

#### Tasks
- [x] 4.1 Create projects list page (from website's IndexedDB)
      - Created `src/editor-web/pages/DashboardPage.tsx`
      - Grid layout with project cards
      - Loading, empty, and error states
      - Delete functionality
- [x] 4.2 RawRecording → Project conversion already done in Phase 3
      - `importFromRawRecording()` in `projectStorage.ts`
      - Default settings, timeline, etc. applied
- [x] 4.3 Create project detail/editor routing
      - Created `src/editor-web/pages/EditorPage.tsx` (placeholder for Phase 5)
      - Video preview working
      - Project details displayed
- [x] 4.4 Test: Imported project appears in list and can be opened ✅

#### Files Created
- `src/editor-web/pages/DashboardPage.tsx` - Project listing with grid layout
- `src/editor-web/pages/EditorPage.tsx` - Editor placeholder with video preview
- Updated `src/editor-web/App.tsx` - Simplified routing

---

### Phase 5: Migrate Editor Code
**Status**: ✅ Complete
**Completed**: 2026-02-02

#### Completed Tasks
- [x] 5.3 Storage adaptation: Created `ProjectStorageCompat.ts` compatibility layer
      - Same API as extension storage, uses website's IndexedDB
      - All editor files now import from compat layer
- [x] 5.5 No `chrome.*` API usage in editor code (confirmed)
- [x] 5.6 Editor works in website context ✅
- [x] Blob serialization: Fixed handoff to serialize Blobs as ArrayBuffers
      - `chrome.runtime.sendMessage` cannot serialize Blobs directly
      - Extension converts Blob → number[] + type
      - Website reconstructs Blob from serialized data
- [x] 5.8 Remove old editor from extension build
      - Removed `editor` from vite.config.ts rollupOptions.input
      - Extension bundle size reduced significantly
- [x] 5.9 Update popup "Projects" button to open website
      - Now opens `localhost:3001` (dev) or `editor.recordio.site` (prod)

#### Skipped Tasks (not needed)
- 5.1 Moving code physically - Not needed, code works in place
- 5.7 Reorganizing recording code - Optional cleanup for later

#### Files Modified
- `src/editor/App.tsx` - Now imports from `ProjectStorageCompat`
- `src/editor/stores/useProjectStore.ts` - Uses website storage
- `src/editor/components/settings/BackgroundSettings.tsx` - Uses website storage
- `src/editor/components/settings/ProjectSettings.tsx` - Uses website storage
- `src/editor/components/canvas/CanvasContainer.tsx` - Uses website storage
- `src/editor/components/ProjectSelector.tsx` - Uses website storage
- `src/editor/debug/ProjectDebugExporter.ts` - Uses website storage
- `src/editor/debug/ProjectDebugImporter.ts` - Uses website storage
- `src/editor-web/storage/ProjectStorageCompat.ts` - NEW compatibility layer
- `src/editor-web/storage/projectStorage.ts` - Added `deleteBlob()`
- `src/shared/types/bridge.ts` - Added `SerializedBlobData` type
- `src/recording/background/background.ts` - Serialize blobs before sending
- `src/editor-web/pages/ImportPage.tsx` - Reconstruct blobs from serialized data
- `src/recording/popup/App.tsx` - Open website instead of extension editor
- `vite.config.ts` - Removed editor from extension build

---

### Phase 6: Polish & Integration
**Status**: ⬜ Not Started
**Prerequisite**: Phase 5 complete

#### Tasks
- [ ] 6.1 "Extension not installed" UI in website
- [ ] 6.2 Add loading states and error handling
- [ ] 6.3 Production build optimization (Terser, minification)
- [ ] 6.4 Test end-to-end: Record → Import → Edit → Export
- [ ] 6.5 (Optional) PWA manifest + service worker for offline

#### Decision Points
- Review UX when extension is not installed
- Discuss obfuscation level

---

## Notes

### Blob Transfer Strategy (Simplified)
Blobs are transferred directly during the one-time handoff:
1. Recording stops → Extension saves to temp IndexedDB
2. Extension opens website tab with `?id={uuid}`
3. Website's bridge requests recording via `BRIDGE_READY`
4. Extension sends `HANDOFF_RECORDING` with actual Blob objects
5. Website stores blobs in ITS OWN IndexedDB (permanent)
6. Website confirms via `HANDOFF_COMPLETE`
7. Extension deletes temp copy

**Why this works**: The content script bridge runs in the website's context, so it can receive Blobs and pass them to the website's storage directly.

### Edge Cases
| Scenario | Handling |
|----------|----------|
| User closes tab before handoff completes | Keep in temp storage, show "pending import" in popup |
| Website takes too long to respond | Timeout (30s?), keep in temp, retry on next visit |
| Extension uninstalled after recording | Lost data (acceptable — user initiated) |
| Multiple recordings pending | Queue them, handoff one at a time |

### Auth Continuity (Deferred)
Current: Extension talks directly to Supabase
Future: Could pass auth token from extension to website via bridge

### Why In-Place Split?
- Single `node_modules`, simpler dependency management
- Easy imports: `import { Button } from '@/shared/components/ui'`
- Can always refactor to true monorepo if needed

---

## Changelog

| Date | Change |
|------|--------|
| 2026-02-02 | Initial plan created |

