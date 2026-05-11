# Workspaces Backend Infrastructure

## Context

All projects are currently single-owner with no collaboration. Sharing is limited to public slug links. We need workspace infrastructure so teams can collaborate on video projects — creating, editing, organizing, and publishing videos within a shared space.

This plan covers the database tables, constraints, RLS policies, and RPC functions needed. Frontend/UI work is out of scope.

---

## Core Concepts

### Workspace Model
- A project with `workspace_id = NULL` is **personal/private** to its owner (current behavior, no migration needed)
- A **workspace** is a shared space requiring a Team or Business plan
- Each user has a **default workspace** (`user_profiles.default_workspace_id`) — tracks the last workspace viewed in the dashboard. New recordings land here. NULL = personal.
- The workspace owner is responsible for billing

### Access Control Strategy
- **All client access goes through RPC functions** (no direct table queries) — per existing architecture
- RPC functions use **SECURITY DEFINER** to bypass RLS and perform access checks explicitly in SQL
- This avoids complex multi-join RLS policies and keeps authorization logic centralized and testable
- Simple RLS policies remain as a safety net (e.g., prevent accidental direct access)

### Project Lifecycle
- **Draft** (`published_at IS NULL`): only project editors can see it. Can be moved between workspaces freely.
- **Published** (`published_at IS NOT NULL`): appears in workspace library, gets a slug, has a watch policy (`workspace` | `public`). **Publishing is permanent** — to remove a video, delete it. Project is anchored to its workspace once published.
- For personal projects (null workspace), publishing generates a slug with `public` watch policy.

### Watch Policy (published projects only)
- `public` — anyone with the link can watch
- `workspace` — only workspace members can watch via the link

### Project Editor Model
- **Every project has explicit editor rows in `project_editors`**, including the project creator
- The project creator is auto-added as an editor on creation
- All edit-access checks use `project_editors` — no special-case for `projects.user_id`
- `projects.user_id` is metadata ("who created this"), not an access control field
- This simplifies all queries: "can user X edit project Y?" = `EXISTS project_editors WHERE project_id = Y AND user_id = X`
- When a member leaves a workspace, their `project_editors` rows are removed via the member removal RPC (with handoff flow first if they own projects)

### Workspace Roles

| Action | Viewer | Creator | Admin |
|--------|--------|---------|-------|
| Watch published videos (workspace/public policy) | Yes | Yes | Yes |
| Browse workspace video library & folders | Yes | Yes | Yes |
| Create new projects in workspace | No | Yes | Yes |
| Move own draft projects into workspace | No | Yes | Yes |
| Move own draft projects out of workspace | No | Yes | Yes |
| Edit a project (if added as project editor) | No | Yes | Yes |
| Add/remove project editors on own projects | No | Yes | Yes |
| Create/manage workspace folders | No | Yes | Yes |
| Move projects into folders | No | Yes (own) | Yes (any) |
| Invite members to workspace | No | No | Yes |
| Remove members from workspace | No | No | Yes |
| Change member roles | No | No | Yes |
| Transfer ownership of orphaned projects | No | No | Yes |
| Delete workspace | No | No | Owner only |

### Workspace Owner
- The workspace owner (`workspaces.owner_id`) always has an explicit row in `workspace_members` with `role = 'admin'`
- This row **cannot be deleted** (enforced in RPC logic — `workspace_member_remove` rejects if target is owner)
- Owner's role **cannot be changed** from admin (enforced in `workspace_member_update_role`)
- Ownership transfer is out of scope for now

### Folders
- Workspace folders are shared by all members, not per-user
- Workspace folders have `user_id = NULL` and `workspace_id = <workspace_id>`
- Personal folders have `user_id = <user_id>` and `workspace_id = NULL`
- Constraint: exactly one of `user_id` or `workspace_id` must be non-null
- Unique constraint on `(workspace_id, name)` to prevent duplicate folder names in a workspace
- Viewers can browse folders; creators can create/organize; admins can do anything

### Member Removal Flow
1. Admin initiates removal of a member
2. RPC checks if the member owns any projects in the workspace (`projects.user_id = member`)
3. If yes: RPC returns the list of owned projects — admin must transfer ownership first via `project_transfer_owner` for each
4. Once no owned projects remain: RPC removes the member's `project_editors` rows for all projects in the workspace, then removes the `workspace_members` row
5. All access is revoked; projects they created (now transferred) stay in the workspace

---

## New Tables

### `workspaces`
```sql
CREATE TABLE public.workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (char_length(name) <= 60),
  owner_id UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### `workspace_members`
```sql
CREATE TABLE public.workspace_members (
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  role TEXT NOT NULL CHECK (role IN ('viewer', 'creator', 'admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);
```

### `project_editors`
```sql
CREATE TABLE public.project_editors (
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);
```
- Validated in RPC: user must be a workspace member with role `creator` or `admin` in the same workspace as the project
- Project creator is auto-added as an editor on project creation

---

## Modified Tables

### `projects` — add columns
```sql
ALTER TABLE public.projects
  ADD COLUMN workspace_id UUID REFERENCES public.workspaces(id),
  ADD COLUMN published_at TIMESTAMPTZ,
  ADD COLUMN watch_policy TEXT CHECK (watch_policy IN ('workspace', 'public'));
```
- `workspace_id` — NULL = personal project
- `published_at` — NULL = draft, non-null = published (permanent)
- `watch_policy` — only meaningful when published; NULL for drafts
- Existing `share_policy` column migrated to `watch_policy`, then deprecated
- Existing `slug` column stays — generated at publish time

### `user_profiles` — add column
```sql
ALTER TABLE public.user_profiles
  ADD COLUMN default_workspace_id UUID REFERENCES public.workspaces(id) ON DELETE SET NULL;
```
- Tracks last workspace viewed in dashboard; new recordings go here
- NULL = personal space
- `ON DELETE SET NULL` handles workspace deletion gracefully

### `folders` — add column + constraints
```sql
ALTER TABLE public.folders
  ADD COLUMN workspace_id UUID REFERENCES public.workspaces(id);

-- Make user_id nullable for workspace folders
ALTER TABLE public.folders
  ALTER COLUMN user_id DROP NOT NULL;

-- Exactly one of user_id or workspace_id must be set
ALTER TABLE public.folders
  ADD CONSTRAINT folders_owner_xor_workspace
  CHECK ((user_id IS NOT NULL) != (workspace_id IS NOT NULL));

-- No duplicate folder names within a workspace
ALTER TABLE public.folders
  ADD CONSTRAINT folders_unique_name_per_workspace
  UNIQUE (workspace_id, name);
```

---

## RLS Policies

RLS serves as a safety net. Primary access control is in SECURITY DEFINER RPCs.

### `workspaces`
- SELECT: member of workspace OR owner
- INSERT/UPDATE/DELETE: owner only

### `workspace_members`
- SELECT: member of the same workspace
- INSERT/UPDATE/DELETE: restricted (handled by RPC)

### `project_editors`
- SELECT: member of the workspace the project belongs to
- INSERT/DELETE: restricted (handled by RPC)

### `projects` (updated)
- SELECT: `auth.uid() = user_id` (personal) OR workspace member (workspace projects — RPC handles granularity)
- UPDATE/INSERT: restricted to owner for safety; RPCs handle workspace editor logic

### `folders` (updated)
- SELECT: `auth.uid() = user_id` (personal) OR workspace member (workspace folders)
- INSERT/UPDATE/DELETE: restricted (handled by RPC)

---

## Private Permission-Check Functions

Internal SQL functions (not exposed via PostgREST) used by all SECURITY DEFINER RPCs for consistent access control. Each raises an exception on failure. Role checks are hierarchical — higher roles pass lower checks.

```sql
-- Raises if caller is not a member of the workspace (any role)
check_workspace_viewer(p_workspace_id UUID)
-- viewer, creator, admin all pass

-- Raises if caller is not at least a creator in the workspace
check_workspace_creator(p_workspace_id UUID)
-- creator, admin pass; viewer fails

-- Raises if caller is not an admin in the workspace
check_workspace_admin(p_workspace_id UUID)
-- admin only

-- Raises if caller is not an editor of the project
check_project_editor(p_project_id UUID)
-- checks project_editors table
```

- These are `SECURITY DEFINER` functions in a private schema (or prefixed `_check_`) so PostgREST doesn't expose them
- Every public RPC calls the appropriate check as its first step
- `check_workspace_viewer` doubles as the "is member" check (viewer is the lowest role)

---

## Key RPC Functions (new)

All functions are `SECURITY DEFINER` with explicit permission checks via the helpers above.

| Function | Purpose |
|----------|---------|
| `workspace_create(name)` | Create workspace, add caller as admin member |
| `workspace_update(workspace_id, name)` | Rename workspace (admin only) |
| `workspace_delete(workspace_id)` | Delete workspace (owner only) |
| `workspace_list()` | List workspaces the caller is a member of |
| `workspace_get(workspace_id)` | Get workspace details + member list + role |
| `workspace_member_add(workspace_id, user_id, role)` | Add member (admin only) |
| `workspace_member_remove(workspace_id, user_id)` | Remove member with handoff check (admin only, cannot remove owner) |
| `workspace_member_update_role(workspace_id, user_id, role)` | Change role (admin only, cannot change owner) |
| `project_publish(project_id, watch_policy)` | Publish project, generate slug, set watch_policy |
| `project_update_watch_policy(project_id, watch_policy)` | Change watch policy on published project |
| `project_editor_add(project_id, user_id)` | Add project editor (project owner or workspace admin; target must be creator/admin in workspace) |
| `project_editor_remove(project_id, user_id)` | Remove project editor (project owner or workspace admin) |
| `project_move_to_workspace(project_id, workspace_id)` | Move draft project into workspace (caller must be creator+ in target workspace) |
| `project_move_to_personal(project_id)` | Move draft project out of workspace (caller must be owner, `published_at IS NULL`) |
| `project_transfer_owner(project_id, new_owner_id)` | Transfer project ownership (admin only, for member removal handoff) |

## Modified RPC Functions

| Function | Change |
|----------|--------|
| `project_create` | Accept optional `workspace_id`; validate caller is creator/admin in workspace; auto-add caller as project editor |
| `project_list(workspace_id?)` | If workspace_id: return published projects + projects caller has edit access to. If NULL: return personal projects. |
| `project_get` | Return workspace info, published state, watch_policy, editors list |
| `folder_create` | Accept optional `workspace_id`; validate caller is creator/admin |
| `folder_list` | Accept optional `workspace_id`; return workspace folders if provided |
| `shared-video-get` (edge fn) | Check `watch_policy` instead of `share_policy`; for `workspace` policy, support optional auth and check workspace membership |

---

## Notes on Related Tables

- `mux_videos` and `render_jobs` reference `project_id` and `user_id`. No schema changes needed — workspace billing queries can join through `projects.workspace_id`.
- `user_assets` remain per-user (not per-workspace) for now.

---

## Migration Strategy
- All existing projects: `workspace_id = NULL`, `published_at = NULL`
- Existing projects with a non-null `slug`: set `published_at = updated_at`, `watch_policy = 'public'`
- Existing projects with `slug IS NULL`: remain drafts
- Deprecate `share_policy` column (drop in a future migration after frontend is updated)
- Existing folders: remain personal (`workspace_id = NULL`, `user_id` unchanged)
- Backfill `project_editors` for all existing projects: insert a row with `(project_id, user_id)` matching `projects.user_id` (creator = editor)

---

## Open TODOs
- [ ] Workspace invitation flow (email invite with accept/reject vs. direct add)
- [ ] Transfer ownership UX when admin removes a member who owned projects
- [ ] Billing integration — workspace owner plan check, seat counting for viewers vs. creators
- [ ] What happens when workspace owner downgrades from Team plan
- [ ] Storage quota attribution per workspace
- [ ] Workspace-level settings (branding, default watch policy, etc.)
- [ ] Workspace ownership transfer

---

## Verification
- Write migration SQL and apply to local Supabase
- Test RPC functions via Supabase SQL editor or edge function calls
- Verify: workspace member can see published workspace projects, non-member cannot
- Verify: project editor can edit, non-editor cannot
- Verify: member removal cascades project_editors after handoff
- Verify: draft project can be moved between workspaces; published project cannot
- Verify: publish flow generates slug and sets watch_policy
- Verify: `shared-video-get` enforces workspace watch policy for authed users and blocks unauthed users
- Verify: folder unique name constraint per workspace
