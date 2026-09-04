# Agent suggestions — share-modal-slug-routing

Out-of-scope findings recorded during implementation (per planning skill).
**Status update 2026-09-04: user asked to apply them all — items 2, 4, 5, 6 applied; 1 turned out already covered; 3 deliberately not applied (see below).**

## 1. Dead base-schema SQL functions → graveyard — ALREADY COVERED, no action
**Where:** `supabase/migrations/00000000000000_schema.sql` (~lines 537/569): `project_get`, `project_list`, `project_share` DB functions.
**Resolution:** Verified against the live local DB: only `user_signup_bootstrap` survives in `public` — the existing `supabase/sql/graveyard.sql` sweeps already drop every `project_*` function. The "dead" definitions exist only as text inside the frozen base migration (never edited by convention). Nothing to do.

## 2. Vacuous slug gate in mux-video-create — APPLIED
Removed the unreachable `if (!access.slug)` 400 branch in `server/src/routes/muxVideoCreate.ts` and tightened `ProjectAccess.slug` to `string` (NOT NULL since the share-access migration) in `projectAccess.ts`.

## 3. `project_editors` name is now misleading — NOT APPLIED (deliberate)
Since the `role` column, rows can be view-only grants — "editors" overstates them. Renaming the table + wire fields (`editors`, `is_editor`, `editor_role`) means a migration plus touching every route/test/client consumer of the contract; the cost outweighs a naming nit. If ever done, do it as its own migration + contract change.

## 4. Seat-billing guard: individual `edit` grants to workspace *viewers* — APPLIED
Viewer-role members hold free view-only seats; edit grants would bypass creator-seat billing. Applied both halves of the sketch:
- `project-editor-set` rejects `role='edit'` for viewer-role targets (400 `Viewers cannot be granted edit access`); `view` grants still fine.
- `EDIT_ACCESS_SQL`'s workspace-edit branch excludes `workspace_members.role = 'viewer'` (workspace owner has no member row and counts as admin).
Tests added in `projectEditors.test.ts` and `projectGet.test.ts`.

## 5. `Dropdown` has no `disabled` prop — APPLIED
Added `disabled` to `shared/components/Dropdown.tsx` (trigger disabled; `interactive-base` supplies the disabled styling). ShareModal's non-owner state now renders the same dropdown layout disabled (matching the confirmed "controls disabled" UX) instead of static text; the owner-only XButton remains hidden for non-owners.

## 6. Stale edge-function integration tests — APPLIED
Deleted `test/integration/edge-functions.test.ts` (targets the decommissioned `functions/v1` runtime) and `test/integration/supabase-rpc.test.ts` (calls RPC functions the graveyard dropped — permanently failing), plus their orphaned helpers `mockRenderWorker.ts` / `mockMuxApi.ts`. `render-worker.test.ts` and shared helpers kept. `test/README.md` updated.
