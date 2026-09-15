# Screenshots — Step 7: Editor reuse seams

Parent: [screenshots-tiered-plan.md](./screenshots-tiered-plan.md)

## Goal
Make the video editor's per-item overlay editing, history batching, display mapping, default-item
factory, name field, item settings, dashboard card and share-policy controls usable from the
screenshot editor WITHOUT changing video behaviour. Every change is a pure refactor; the video
call sites keep their signatures.

## Changes
1. `editor/hooks/useDisplayMapper.ts` — `DisplayMapperContext` / `DisplayMapperProvider`; the hook
   returns the provided mapper when inside a provider, else the store-derived one (unchanged path).
2. `editor/hooks/useHistoryBatcher.ts` — `createHistoryBatcher(getTemporal)` factory with
   per-instance counters; `useHistoryBatcher = createHistoryBatcher(() => useProjectStore.temporal)`.
   Exported `HistoryBatcher` type.
3. `editor/components/canvas/overlay-item/` — `OverlayItemEditor`, `ArrowPointHandles`,
   `InlineTextEditor` moved out of `CanvasOverlayEditor.tsx` with explicit props
   `{ item, updateItem, batcher, previewItemRef, textScale, constraintBounds?, isEditing, onEnterEdit,
   onExitEdit }` — no store reads inside. `OverlayEditor` (video) becomes the thin wrapper that
   reads the stores and passes them down.
4. `editor/overlay/defaultItems.ts` — `createDefaultItemInRect(type, area, defaults)`;
   `createDefaultItem(type, outputSize, settings)` is a wrapper over it (re-exported from
   `OverlayInspector.tsx` so `TimelineToolbar` is untouched).
5. `OverlayInspector.tsx` — `OverlayItemSettings` exported; `block` / `updateSettings` optional
   (neither is read).
6. `header/ProjectNameField.tsx` — optional `{ value, onCommit, placeholder, ariaLabel, inputId }`;
   defaults keep the project-store behaviour and the `#project-name-input` handle.
7. `dashboard/ProjectCard.tsx` — `shareUrl`, `badge`, `showDuration` props (defaults reproduce the
   current card).
8. `share/SharePolicyControls.tsx` — `POLICY_OPTIONS`, `ACCESS_OPTIONS`, `SharePolicyControls`
   (visibility + workspace-access rows), `ShareCreatorRow`, `OwnerOnlyNote`; `ShareModal` composes
   them and keeps invite/grants/Mux logic.

## Verification
- `npx tsc -b` (webapp) clean, eslint clean on touched files, vitest green.
- Manual video parity: select each overlay type, drag/resize/edit text, arrow endpoints, undo is one
  step per drag; ShareModal looks and behaves the same.
