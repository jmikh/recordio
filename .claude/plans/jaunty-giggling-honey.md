# Workspace Permissions Refactor — One Clear Model

## Context

Authorization for videos/workspaces is currently inconsistent and scattered. An audit of `server/src/routes/**` found **four different patterns** guarding "can write to a video" (a `canEditProject` 403, a near-duplicate `getProjectIfEditor` 404, silent `WHERE owner_id = $user` clauses, and an owner-only `if`), several routes with **no membership check at all** (`projectCreateV2`, `billing/stripeCheckout`), a `projectGet` that gates *viewing* on *edit* rights (so viewer-seat members literally cannot open a published video in-app), and duplicate routes (`project-rename` vs `project-update-name`). The data model has redundant `created_by`/`owner_id` columns and a `share_policy` vocabulary (`public|workspace|private`) whose names don't match the mental model.

**Goal:** collapse all video/workspace authorization to **one membership lookup + a small set of predicates** called by every route, and give both the backend and the end-user a single clear model:

- **Roles (seats)** stay `viewer | creator | admin` (`workspace_members.role`).
- **Video state** becomes `visibility: draft | workspace | link` (rename of `share_policy`; `draft`=unpublished, `workspace`=published to workspace, `link`=anyone with the link).
- **Editors** of a video = a *current* workspace member who is the **creator** OR has an explicit `project_editors` row. **Admins are NOT automatic editors** — they opt in by adding a `project_editors` row, so drafts stay private by default. Editing includes publishing/changing visibility, deleting, transcribing, rendering.
- **Viewers**: a viewer-seat member sees a video only if it's published `workspace` (any member) or `link` (anyone). Drafts are visible only to editors.
- **Member removal**: the removed member's `draft` videos are soft-deleted; their published (`workspace`/`link`) videos stay with `created_by` unchanged (editable only by an admin who opts in). No ownership transfer.

Decisions confirmed with the product owner: admins are opt-in editors; removal drops drafts and keeps published as-is; publishing is gated by `canEditVideo`; `/transcribe` becomes editor-gated with the subscription paywall **removed**; `owner_id` is **dropped** (`created_by` is the single creator identity).

Key architecture fact (verified): the server talks to Postgres over a single **superuser `postgres` pool** (`server/src/server.ts`), and **all RLS policies on `public.*` were dropped** (`supabase/migrations/20260513194112_drop_all_rls_policies.sql`). RLS is therefore *not* the enforcement layer — the TS predicates are. This refactor is a TS-predicate + schema-column change; **no `public.*` RLS rewrites are needed**. (`storage.objects` path-prefix policies are unrelated and untouched.)

## The new authorization module

Rewrite `server/src/services/projectAccess.ts` to expose one membership lookup and a small predicate family. All take a `Db` and an explicit `userId` (never `auth.uid()`), and resolve membership + creator + editor in a **single SQL statement** to avoid round-trips.

```ts
export type Role = 'viewer' | 'creator' | 'admin';
export type Visibility = 'draft' | 'workspace' | 'link';

// Single source of truth; replaces isWorkspaceMember / isWorkspaceAdmin.
// null if not a member OR workspace soft-deleted.
getMembership(db, userId, workspaceId): Promise<Role | null>

// Live project + live workspace + caller is a CURRENT member AND
// (caller === created_by OR has a project_editors row). One query.
// A removed member's stale created_by does NOT pass (membership JOIN gates it).
canEditVideo(db, userId, projectId): Promise<boolean>

// canEditVideo OR (visibility='workspace' AND member) OR (visibility='link', anyone).
// userId may be null for unauthenticated link viewers.
canViewVideo(db, userId | null, projectId): Promise<boolean>

// Member with role in {creator, admin}. Viewers cannot create.
canCreateVideo(db, userId, workspaceId): Promise<boolean>

// Returns the editable row's { id, created_by, slug, workspace_id } or null
// — one-round-trip replacement for getProjectIfEditor for routes that need the row.
getVideoForEdit(db, userId, projectId): Promise<VideoRow | null>
```

Notes:
- Keep `isWorkspaceAdmin` as a thin alias — `(await getMembership(...)) === 'admin'` — so the ~7 workspace-admin call sites don't churn while the duplicated SQL is removed.
- `canEditVideo` excludes soft-deleted rows; `projectRestore` needs a deleted-inclusive variant (`getVideoForEdit` with `deleted_at IS NOT NULL` allowed, or a small `canEditDeletedVideo`).

## Route-by-route migration

Standardize responses: **403 for authenticated-but-unauthorized, 404 only for genuinely-absent rows** (replaces the silent-fail `{deleted:false}` clauses).

| Route | Now | New |
|---|---|---|
| `projects/projectGet.ts` | `canEditProject` (viewers can't view — bug) | `canViewVideo` |
| `projects/projectList.ts` | `isWorkspaceMember` | `getMembership !== null` |
| `projects/projectUpdate.ts` | `canEditProject` | `canEditVideo` |
| `projects/projectRename.ts` | `canEditProject` | `canEditVideo` (keep as the single name route) |
| `projects/projectUpdateName.ts` | duplicate of rename | **Delete**; remove from `app.ts` + `shared/api/index.ts`. First confirm which name the client (`CloudProjectService`) actually calls; keep that one, drop the other (add a temporary alias if the client uses `project-update-name`). |
| `projects/projectShare.ts` | owner-only `if` | `canEditVideo`. Accept `visibility` (`draft|workspace|link`); allow un-publishing back to `draft`. Default on first share → `link`. |
| `projects/projectDelete.ts` | silent `WHERE owner_id` | `canEditVideo` → 403; soft-delete; 404 if absent |
| `projects/projectRestore.ts` | silent `WHERE owner_id` | deleted-inclusive edit check → 403; restore |
| `projects/projectConfirmUpload.ts` | silent `WHERE owner_id` | `canEditVideo` → 403; confirm |
| `projects/projectCreateV2.ts` | **no check** + upsert-takeover bug | `canCreateVideo` → 403 for viewers/non-members. Fix upsert: `ON CONFLICT (id) DO UPDATE ... WHERE projects.created_by = $creator`; if the conflicting row belongs to someone else, update 0 rows → return 409 (no silent takeover). |
| `projects/projectUpdateThumbnail.ts` | `getProjectIfEditor` (404) | `getVideoForEdit` → 403 |
| `renderJobCreate.ts` | `getProjectIfEditor` (404) | `getVideoForEdit` → 403 (attribution = caller, unchanged) |
| `muxVideoCreate.ts` | `getProjectIfEditor`; attributes to `owner_id` | `getVideoForEdit` → 403; attribute to `created_by` (equal to old `owner_id` for all non-transferred rows) |
| `renderJobGetStatus.ts` | `canEditProject` | `canEditVideo` |
| `transcribe.ts` | member + active/trialing subscription (paywall), no editor check | `canEditVideo` → 403. **Remove the subscription gate** (per decision — transcription becomes an editor capability). |
| `billing/stripeCheckout.ts` | **no membership check** | `getMembership === 'admin'` → 403 (checkout mutates workspace billing) |
| `billing/stripePortal.ts` | implicit-404 via JOIN | make membership explicit via `getMembership` (clear 403); low priority |
| `billing/subscriptionChange.ts`, `subscriptionGet.ts` | inline membership/admin JOINs | `getMembership` |
| `workspaces/*` (invite, inviteRescind, memberUpdateRole, rename, seatsSet) | `isWorkspaceAdmin` | `getMembership === 'admin'` |
| `workspaces/workspaceGet.ts`, `workspaceSetDefault.ts` | `isWorkspaceMember` | `getMembership !== null` |
| `workspaces/workspaceMemberRemove.ts` | admin check + **transfer** | `getMembership === 'admin'` + **rewrite body** (below) |
| `sharedVideoGet.ts` (public, no auth) | `share_policy !== 'public'` → 404 | `visibility !== 'link'` → 404 (rename only) |
| `assets/storageDownloadUrls.ts` | hardcoded `ADMIN_USER_ID` bypass | move the UUID to env config (out of core model, but fix the smell) |

Self-scoped routes (`assets/*`, `workspaceCreate`, `workspaceInviteAccept`, `userProfileGet`, etc.) are unaffected.

## Member-removal rewrite (`workspaces/workspaceMemberRemove.ts`)

Replace the current transfer logic with a **transaction**: soft-delete the member's drafts, keep published videos untouched, strip their editor grants, delete membership. This needs a real transaction — extend the `Db` port (`server/src/ports/db.ts`, currently just `query`) with `transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>` (pg `pool.connect()` → `BEGIN/COMMIT`; the test fake runs the fn against the same db).

```sql
BEGIN;
-- 1. Soft-delete the removed member's DRAFT videos in this workspace.
UPDATE projects SET deleted_at = NOW()
 WHERE workspace_id = $1 AND created_by = $2
   AND visibility = 'draft' AND deleted_at IS NULL;
-- 2. Remove their explicit editor grants in this workspace.
DELETE FROM project_editors pe USING projects p
 WHERE pe.project_id = p.id AND p.workspace_id = $1 AND pe.user_id = $2;
-- 3. Remove membership; 0 rows => 404 (ROLLBACK).
DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2;
COMMIT;
```

Published (`workspace`/`link`) videos are intentionally left with `created_by` unchanged. Response changes from `{ transferredCount }` → `{ removed: true, draftsDeleted }`; update `WorkspaceMemberRemoveResponseSchema` (`shared/api/workspaces.ts`) and the caller in `MembersPage.tsx`.

## DB migrations (`supabase/migrations/`) — land LAST, code first

Follow the repo convention (new migration per concern; deploy code that tolerates both, then migrate). Two migrations:

**1. Rename `share_policy` → `visibility` and re-vocabulary values.**
```sql
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_share_policy_check;
ALTER TABLE projects RENAME COLUMN share_policy TO visibility;
UPDATE projects SET visibility = CASE
  WHEN visibility IS NULL OR visibility = 'private' THEN 'draft'
  WHEN visibility = 'public' THEN 'link'
  ELSE 'workspace' END;
ALTER TABLE projects
  ALTER COLUMN visibility SET DEFAULT 'draft',
  ALTER COLUMN visibility SET NOT NULL,
  ADD CONSTRAINT projects_visibility_check CHECK (visibility IN ('draft','workspace','link'));
```

**2. Drop `owner_id`** (only after PR1 is fully live and nothing references it):
```sql
DROP INDEX IF EXISTS idx_projects_owner_id;
ALTER TABLE projects DROP COLUMN IF EXISTS owner_id;
```
Precondition gate before running: `SELECT count(*) FROM projects WHERE owner_id <> created_by` must be **0**. If non-zero (videos transferred by the old member-remove), decide per row (likely re-grant the transferee via `project_editors`).

Check `supabase/sql/functions/` / `sql/graveyard.sql` for any *live* SQL function still naming `share_policy`/`owner_id` and redeploy via `sql/deploy.sh` in the same push. Keep `workspaces.owner_id` (a different column — the workspace owner lock).

## Shared types + downstream (`shared/api/`)

- `shared/api/projects.ts`: `SharePolicy`→`Visibility` (`'draft'|'workspace'|'link'`); `CloudProject.share_policy`→`visibility`, drop `owner_id`; same on `CloudProjectSummary`; `ProjectShareRequestSchema.sharePolicy`→`visibility`.
- `shared/api/index.ts`: remove the `project-update-name` entry.
- `shared/api/workspaces.ts`: update `WorkspaceMemberRemoveResponseSchema`.
- Downstream refs (from grep): server routes reading the jsonb (`projectGet`, `projectList`, `sharedVideoGet`, `projectShare`), `webapp/src/storage/cloudProjectService.ts` + its `.test.ts` fixture (`share_policy: 'public'`→`visibility:'link'`), `server/test/helpers/db.ts` seed helper, and the project-share/member-remove client callers. Extension, render-worker, functions, cdn have **no** references.

## Rollout order

1. **PR1** — new `projectAccess.ts` + all route rewrites + member-remove rewrite + `Db.transaction`, still reading `share_policy`/`owner_id` columns; predicates key on `created_by`. Safe pre-drop because `created_by == owner_id` for all non-transferred rows. **Audit prod for `owner_id <> created_by` first.**
2. **PR2** — `visibility` rename migration + switch code to `visibility`.
3. **PR3** — drop `owner_id` migration (gated on the count-0 precondition).

## Risks

- **Legacy `owner_id <> created_by` rows** (old transfers) — the one correctness risk of keying on `created_by`; audit before PR1.
- **`projectGet` view-widening** — workspace members and link viewers now receive full `project_data`; confirm nothing in it must stay editor-only.
- **Transcription cost** — dropping the subscription gate means any editor (incl. free workspaces) can trigger OpenAI Whisper; acceptable per decision, but note the unbounded-cost surface.
- **Member-remove UX change** — admins no longer inherit a departing member's videos; drafts vanish, published videos become admin-opt-in-editable. Update `MembersPage.tsx` copy.
- **Render/storage path continuity** — mux/render output path switches from `owner_id` to `created_by` prefix (equal for non-transferred rows); verify the render worker + `storageDownloadUrls` still resolve.

## Verification

- **New unit test** `server/test/services/projectAccess.test.ts` (follow the `describe.runIf(hasTestDb())` + `createTestPool` + seed-helper pattern used across `server/test`): assert the full truth table — creator edits, explicit editor edits, **admin is NOT an auto-editor**, removed-member is blocked, viewer cannot create, link view works unauthenticated, workspace view requires membership, soft-deleted workspace blocks all.
- **Update changed route tests**: `workspaceMemberRemove.test.ts` (transfer → drafts-deleted/published-kept), `projectShare.test.ts` (owner-only→editor; `share_policy`→`visibility`; default `link`), `sharedVideoGet.test.ts` (`private`/`null`→`draft`), `projectGet.test.ts` (add workspace-member-can-view), `projectCreateV2.test.ts` (viewer-403 + upsert-takeover-409). Update `server/test/helpers/db.ts` seed helper (`sharePolicy`→`visibility`, drop `ownerId`) and extend the `Db` fake with `transaction`.
- **Run** `npm test` in `server/` against the local `supabase start` DB (`.env.test`).
- **End-to-end sanity** (dev build): as a viewer-seat member, confirm you can open a `workspace`-published video but not a draft; as a creator, publish a draft to `workspace` then `link` and confirm the public link route serves it; remove a member and confirm their draft disappears while their published video remains (admin can edit only after adding themselves as an editor).
