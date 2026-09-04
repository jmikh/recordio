# Step 1 — Migration + share-model server changes

## Migration: `supabase/migrations/20260904083048_share_access_model.sql`

One concern: the share access model. All statements idempotent-safe where possible.

1. `projects.slug` DEFAULT `left(replace(gen_random_uuid()::text,'-',''),12)` (DB-side so every insert path gets one, deploy-order safe).
2. Backfill NULL slugs via DO block with unique_violation retry (unique index `projects_slug_key` exists), then `SET NOT NULL`.
3. `share_policy`: `NULL → 'private'` backfill, then `DEFAULT 'private'`, `SET NOT NULL` (CHECK already allows the 3 values).
4. `projects.workspace_access text NOT NULL DEFAULT 'view' CHECK (view|edit)` — level workspace members get when policy ∈ (workspace, public); ignored when private.
5. `project_editors.role text NOT NULL DEFAULT 'edit' CHECK (view|edit)` — existing rows were edit grants.

## Server

- **projectShare.ts**: request `{ projectId, sharePolicy?, workspaceAccess? }`. `sharePolicy` still defaults to `'public'` when omitted (wire compat — the old Publish button calls `{projectId}` until Step 5 lands). `workspaceAccess` omitted = keep current. `canShare` entitlement required only when effective policy ≠ private. Update + override-rule deletes in ONE atomic CTE statement (no transaction surface on the pooled db — see workspaceInviteAccept.ts:85):
  `WITH updated AS (UPDATE projects SET share_policy=$2, workspace_access=COALESCE($3, workspace_access) ... RETURNING ...) DELETE FROM project_editors USING updated WHERE policy shareable AND (access='edit' OR role='view') RETURNING user_id` — log removed user ids via `req.logCtx`.
- **projectAccess.ts**:
  - `canEditProject` + `getProjectIfEditor`: editor grant now requires `pe.role='edit'`; add workspace-edit branch (`policy ∈ (workspace,public) AND workspace_access='edit' AND (w.owner_id=$2 OR wm row)`); `getProjectIfEditor` gains the workspaces LEFT JOIN (no liveness semantics change).
  - New `canViewProject` (for Step 3): signed-in ladder — `policy='public'` OR owner OR any pe row OR (`policy='workspace'` AND workspace member); anon-public handled at the route.
- **projectGet.ts**: `is_shared := share_policy IN ('public','workspace')`; add `workspace_access`, `owner_name`, `owner_email` (scalar subqueries on `auth.users`/`user_profiles`); editors gain `role`.
- **projectList.ts**: same `is_shared`; add `workspace_access`, `editor_role` (caller's pe.role or null; `is_editor` kept).
- **projectCreateV2.ts**: `RETURNING slug`; response schema + return gain `slug`.
- **shared/api/projects.ts**: `AccessRoleSchema` (view|edit) used for both `workspace_access` and editor `role`; `ProjectShareRequestSchema` gains `workspaceAccess?`; `CloudProject` gains `workspace_access`, `owner_name`, `owner_email`, editors `role`, `slug: string` (non-null now truthful); `CloudProjectSummary` gains `workspace_access`, `editor_role`, `slug: string`.

## Tests

- `projectShare.test.ts`: two-part updates; override-rule deletion matrix (workspace/view kills view grants keeps edit; edit kills all; private keeps all); private-without-subscription allowed; stable slug; owner-only pinned.
- `projectCreateV2.test.ts`: response includes the 12-hex slug; row has it.
- `projectGet.test.ts` / `projectList.test.ts`: `is_shared` derivation, `workspace_access`, `editor_role`, owner fields, editors role.
- `muxVideoCreate.test.ts:221` and other `slug: null` seeds: NOT NULL now — rework (the "no slug → 404" test premise dies; slug-always makes the gate vacuous).
- `helpers/db.ts` seedProject: keep defaults; add `workspaceAccess` opt; editor-seeding gains role.
