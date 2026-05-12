# Workspaces Backend Infrastructure

## Context

All projects are currently single-owner with no collaboration. Sharing is limited to public slug links. We need workspace infrastructure so teams can collaborate on video projects — creating, editing, organizing, and publishing videos within a shared space.

This plan covers the database tables, constraints, RLS policies, and RPC functions needed. Frontend/UI work is out of scope.

---

## Core Concepts

### Workspace Model
- **Every project belongs to a workspace** — `workspace_id` is NOT NULL on `projects`
- A **personal workspace** is a regular workspace with `is_personal = TRUE` and a single admin member (the owner). It is created lazily by `workspace_get_default` the first time it is needed
- A **team workspace** is a shared space (`is_personal = FALSE`) that can have multiple members. Requires a Team or Business plan
- Each user has a **default workspace** (`user_profiles.default_workspace_id`) — tracks the last workspace viewed in the dashboard. New recordings land here. Always set; never NULL. Enforced in `workspace_get_default`
- **Billing lives on the workspace** — subscriptions, plan, and seat counts are attributes of the workspace. The workspace owner is the billing responsible party

### Access Control Strategy
- **All client access goes through RPC functions** (no direct table queries) — per existing architecture
- RPC functions use **SECURITY DEFINER** to bypass RLS and perform access checks explicitly in SQL
- Permission checks are performed via `assert_*` helper functions (e.g., `assert_workspace_admin`, `assert_project_editor`). Each raises an exception on failure. These live in `sql/functions/assert_*.sql` and are revoked from all client roles
- This avoids complex multi-join RLS policies and keeps authorization logic centralized and testable
- Simple RLS policies remain as a safety net (e.g., prevent accidental direct access)

### Project Lifecycle
- **Draft** (`slug IS NULL`): only the owner and explicit project editors can access it. Can be moved between workspaces freely.
- **Published** (`slug IS NOT NULL`): has a `share_policy` that controls who can watch via the shared link. **Publishing is permanent** — to remove a video, delete it.
- **Only the project owner (`owner_id`) can delete a project** — workspace admins cannot delete projects they don't own.

### Share Policy (controls watch-link access only)
- `public` — anyone with the link can watch
- `workspace` — only workspace members can watch via the link
- `private` — only the project owner and explicit project editors can watch via the link

### Library Visibility (separate from share_policy)
- A user's library shows all projects they own + all projects where they are an explicit editor, regardless of draft/published status
- Workspace library (shared view) shows all published projects in the workspace to all workspace members — `share_policy` gates the external watch link only, not internal library visibility
- UI dashboard panels are out of scope for this plan

### Project Creator vs. Owner
Every project has two distinct user references:

- **`created_by`** (`projects.created_by`) — immutable. The user who originally recorded/created the project. Never changes, even after ownership transfer. Used for display ("recorded by…") and history.
- **`owner_id`** (`projects.owner_id`) — the current owner. Controls who can move the project, add/remove editors, and is the target of the member-removal handoff flow. Transferred via `project_transfer_owner`.

`projects.user_id` (existing column) becomes `created_by` in the migration — rename for clarity. `owner_id` is seeded from `created_by` on backfill and diverges only after a transfer.

### Project Editor Model
- The **project owner** (`owner_id`) has implicit edit access — no row in `project_editors` needed
- `project_editors` holds additional editors beyond the owner (collaborators explicitly granted access)
- Edit-access check: `owner_id = caller` OR `EXISTS project_editors WHERE project_id = Y AND user_id = X`
- `assert_project_editor` encapsulates this two-part check
- When a member leaves a workspace, their `project_editors` rows are removed. If they are the `owner_id` of any projects, ownership must be transferred first via the handoff flow

### Workspace Roles

| Action | Viewer | Creator | Admin |
|--------|--------|---------|-------|
| Watch published videos (workspace/public policy) | Yes | Yes | Yes |
| Browse workspace video library & folders | Yes | Yes | Yes |
| Create new projects in workspace | No | Yes | Yes |
| Move own draft projects into workspace | No | Yes | Yes |
| Move own draft projects out of workspace | No | Yes | Yes |
| Edit a project (if added as project editor) | No | Yes | Yes |
| Add/remove project editors on owned projects | No | Yes (own) | Yes (any) |
| Create/manage workspace folders | No | Yes | Yes |
| Move projects into folders | No | Yes (own) | Yes (any) |
| Delete a project | No | Yes (own) | Yes (own) |
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

### Personal Workspace Rules
- `is_personal = TRUE` workspaces have exactly one member (the owner) and this cannot be changed
- Personal workspaces cannot be deleted via `workspace_delete` (blocked in RPC)
- Personal workspace `share_policy` for published projects defaults to `public`
- Created lazily by `workspace_get_default` — no signup trigger needed

### Default Workspace Guarantee
- `user_profiles.default_workspace_id` may be NULL (e.g. new users, or after workspace deletion)
- `workspace_get_default` is the single enforcement point:
  1. If `default_workspace_id` is set and valid → return it
  2. If stale (workspace deleted, membership revoked) or NULL → look up the user's personal workspace (`is_personal = TRUE`, caller is a member)
  3. If no personal workspace exists → create one (name = "My Workspace", `is_personal = TRUE`, add caller as admin member)
  4. Write the resolved workspace id back to `user_profiles.default_workspace_id` and return it
- Callers never need to handle a null or missing workspace — `workspace_get_default` guarantees one exists

### Folders
- **Every folder belongs to a workspace** — `workspace_id` is NOT NULL on `folders`
- `user_id` is dropped from folders entirely (or nulled out in migration); workspace membership is the only access axis
- Personal organization is handled by creating folders in the user's personal workspace
- Unique constraint on `(workspace_id, name)` to prevent duplicate folder names in a workspace
- Viewers can browse folders; creators can create/organize; admins can do anything

### Member Removal Flow
1. Admin initiates removal of a member
2. RPC checks if the member is the `owner_id` of any projects in the workspace
3. If yes: RPC returns the list of those projects — admin must call `project_transfer_owner` for each before removal can proceed
4. Once no owned projects remain: RPC removes the member's `project_editors` rows for all projects in the workspace, then removes the `workspace_members` row
5. All access is revoked; `created_by` on those projects is untouched — history is preserved

---

## New Tables

### `workspaces`
```sql
CREATE TABLE public.workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (char_length(name) <= 60),
  owner_id UUID NOT NULL REFERENCES auth.users(id),
  is_personal BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
```
- `is_personal` — TRUE only for auto-created personal workspaces

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

### `workspace_invitations`
```sql
CREATE TABLE public.workspace_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('viewer', 'creator', 'admin')),
  invited_by UUID NOT NULL REFERENCES auth.users(id),
  token UUID NOT NULL DEFAULT gen_random_uuid(),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'expired')),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '7 days',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, email)
);
```
- One pending invitation per email per workspace — re-inviting replaces the existing row
- `token` is the secret in the invite link; looked up without auth
- On accept: insert into `workspace_members` with the invitation's `role`, set `status = 'accepted'`
- `workspace_member_add` remains the direct-add path (no invite email sent)

### `project_editors`
```sql
CREATE TABLE public.project_editors (
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);
```
- Validated in RPC: target user must be a workspace member with role `creator` or `admin` in the same workspace as the project
- The project owner is **not** stored here — owner access is implicit via `owner_id`

---

## Modified Tables

### `projects` — add/rename columns
```sql
-- Rename user_id → created_by (immutable creator, history only)
ALTER TABLE public.projects RENAME COLUMN user_id TO created_by;

-- Add owner_id (current owner, transferable)
ALTER TABLE public.projects
  ADD COLUMN owner_id UUID NOT NULL REFERENCES auth.users(id);

ALTER TABLE public.projects
  ADD COLUMN workspace_id UUID NOT NULL REFERENCES public.workspaces(id);

-- Update the existing share_policy CHECK to include the new values
ALTER TABLE public.projects
  DROP CONSTRAINT IF EXISTS projects_share_policy_check,
  ADD CONSTRAINT projects_share_policy_check
    CHECK (share_policy IN ('workspace', 'public', 'private'));
```
- `created_by` — immutable; who originally created the project. Display only, not used for access control
- `owner_id` — current owner; controls who can manage the project and is subject to the member-removal handoff. Seeded from `created_by` on migration
- `workspace_id` — NOT NULL; every project belongs to a workspace (including personal)
- `share_policy` — reused existing column; values expanded to `workspace` | `public` | `private`; NULL for drafts
- Existing `slug` column stays — generated at publish time

### `user_profiles` — add column
```sql
ALTER TABLE public.user_profiles
  ADD COLUMN default_workspace_id UUID REFERENCES public.workspaces(id) ON DELETE SET NULL;
```
- Tracks last workspace viewed in dashboard; new recordings go here
- `ON DELETE SET NULL` handles workspace deletion gracefully; `workspace_get_default` heals the value on next call

### `folders` — replace user_id with workspace_id
```sql
-- Add workspace_id (backfill before adding NOT NULL)
ALTER TABLE public.folders
  ADD COLUMN workspace_id UUID REFERENCES public.workspaces(id);

-- Backfill: assign existing folders to their owner's personal workspace
-- (done in migration data step before the NOT NULL constraint)

ALTER TABLE public.folders
  ALTER COLUMN workspace_id SET NOT NULL;

-- Drop user_id — workspace membership is the only access axis now
ALTER TABLE public.folders
  DROP COLUMN user_id;

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

### `workspace_invitations`
- SELECT: workspace admin OR the invited email matches `auth.email()`
- INSERT/UPDATE/DELETE: restricted (handled by RPC)

### `project_editors`
- SELECT: member of the workspace the project belongs to
- INSERT/DELETE: restricted (handled by RPC)

### `projects` (updated)
- SELECT: workspace member (all projects have a workspace; RPC handles granularity)
- UPDATE/INSERT: restricted to `owner_id` for safety; RPCs handle workspace editor logic

### `folders` (updated)
- SELECT: workspace member (`workspace_id` is always set)
- INSERT/UPDATE/DELETE: restricted (handled by RPC)

---

## Assert Permission-Check Functions

Internal SQL functions in `sql/functions/assert_*.sql`. Not exposed via PostgREST (revoked from all client roles). Called as the first step in every SECURITY DEFINER RPC. Each raises an exception on failure. Role checks are hierarchical — higher roles pass lower checks.

```sql
-- Raises if caller is not a member of the workspace (any role)
assert_workspace_viewer(p_workspace_id UUID)
-- viewer, creator, admin all pass

-- Raises if caller is not at least a creator in the workspace
assert_workspace_creator(p_workspace_id UUID)
-- creator, admin pass; viewer fails

-- Raises if caller is not an admin in the workspace
assert_workspace_admin(p_workspace_id UUID)
-- admin only

-- Raises if caller is not an editor of the project
assert_project_editor(p_project_id UUID)
-- passes if caller is owner_id OR has a row in project_editors
```

These already exist in `sql/functions/` and follow the `SECURITY DEFINER` + `REVOKE ALL` pattern.

---

## Key RPC Functions (new)

All functions are `SECURITY DEFINER`. Permission checks are the first statement in each function, using the `assert_*` helpers above.

| Function | Purpose |
|----------|---------|
| `workspace_create(name)` | Create team workspace, add caller as admin member |
| `workspace_update(workspace_id, name)` | Rename workspace (assert_workspace_admin) |
| `workspace_delete(workspace_id)` | Delete workspace — owner only, blocked for personal workspaces |
| `workspace_list()` | List workspaces the caller is a member of |
| `workspace_get(workspace_id)` | Get workspace details + member list + role (assert_workspace_viewer) |
| `workspace_get_default()` | Returns caller's default workspace; falls back to personal workspace and heals `default_workspace_id` if stale |
| `workspace_invite(workspace_id, email, role)` | Create/replace invitation, send invite email (assert_workspace_admin; blocked on personal workspaces) |
| `workspace_invite_accept(token)` | Accept invitation — insert workspace_members row, set status = accepted; validates token not expired |
| `workspace_invite_decline(token)` | Decline invitation — set status = declined |
| `workspace_member_add(workspace_id, user_id, role)` | Directly add an existing user as a member (assert_workspace_admin; blocked on personal workspaces; no invite email) |
| `workspace_member_remove(workspace_id, user_id)` | Remove member with handoff check (assert_workspace_admin; cannot remove owner) |
| `workspace_member_update_role(workspace_id, user_id, role)` | Change role (assert_workspace_admin; cannot change owner) |
| `project_publish(project_id, share_policy)` | Publish project — generate slug, set share_policy (assert_project_editor; raises if already published) |
| `project_update_share_policy(project_id, share_policy)` | Change watch policy on published project (assert_project_editor) |
| `project_editor_add(project_id, user_id)` | Add project editor (caller must be project owner or workspace admin; target must be creator/admin in workspace) |
| `project_editor_remove(project_id, user_id)` | Remove project editor (caller must be project owner or workspace admin) |
| `project_move_to_workspace(project_id, workspace_id)` | Move draft project to a different workspace (caller must be project owner and creator+ in target workspace; project must be draft) |
| `project_transfer_owner(project_id, new_owner_id)` | Transfer `owner_id` to another workspace member (assert_workspace_admin; used in member-removal handoff). `created_by` is not touched. |

## Modified RPC Functions

| Function | Change |
|----------|--------|
| `project_create` | Requires `workspace_id` (no longer optional); validate caller is creator/admin in workspace; sets `created_by = owner_id = caller` (no `project_editors` row needed for the owner) |
| `project_list(workspace_id)` | Return published projects + projects caller has edit access to in the workspace |
| `project_get` | Return workspace info, slug, share_policy, editors list, `created_by`, `owner_id` |
| `folder_create` | Accept `workspace_id`; validate caller is creator/admin |
| `folder_list` | Accept `workspace_id`; return workspace folders |
| `shared-video-get` (edge fn) | Check `share_policy` instead of `share_policy`; `workspace` → check workspace membership; `private` → check project editor/owner; `public` → allow anyone |

---

## Billing Model

**Subscription lives on the workspace**, not the user. The workspace owner manages billing.

### Plans

| Plan | Description |
|------|-------------|
| `free` | Default. Personal workspace only. No team workspaces. |
| `pro` | Paid. Single user — unlocks advanced features, no extra seats. |
| `business` | Paid. Multi-seat. Seat count is chosen at purchase (minimum 1, which is the owner alone). Controls how many members can be in the workspace. |

### Schema — `workspace_subscriptions` table
Separate table (not columns on `workspaces`) to keep billing concerns isolated:

```sql
CREATE TABLE public.workspace_subscriptions (
  workspace_id UUID PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro', 'business')),
  seat_count INT NOT NULL DEFAULT 1,         -- meaningful for 'business' plan only
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  current_period_end TIMESTAMPTZ,            -- renewal date shown in settings
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```
- Every workspace gets a row on creation (via `workspace_create` / `workspace_get_default`) with `plan = 'free'`
- `current_period_end` — shown in workspace settings as "renews on …"
- `seat_count` — enforced in `workspace_member_add` and `workspace_invite_accept`: raise if `(current member count) >= seat_count`

### Workspace Settings — Billing UI data

`workspace_get(workspace_id)` returns the subscription row alongside workspace details. The settings panel shows:
- Current plan + renewal date (if subscribed)
- Active seat count vs. purchased seat count (Business)
- If `free`: CTA to upgrade to **Pro** or **Business** (with seat picker, min 1)
- If subscribed: option to change plan / buy more seats → handled via Stripe billing portal or checkout session (edge function)

### New RPCs

| Function | Purpose |
|----------|---------|
| `workspace_subscription_get(workspace_id)` | Return subscription details for the settings panel (assert_workspace_admin) |
| `workspace_checkout_create(workspace_id, plan, seat_count?)` | Create a Stripe checkout session for upgrade (assert_workspace_admin; edge function) |
| `workspace_billing_portal(workspace_id)` | Return a Stripe billing portal URL for managing existing subscription (assert_workspace_admin; edge function) |

Stripe webhooks update `workspace_subscriptions` server-side (edge function, no JWT auth — validated by Stripe signature).

---

## Notes on Related Tables

- `mux_videos` and `render_jobs` reference `project_id` and `user_id`. No schema changes needed — workspace billing queries can join through `projects.workspace_id`.
- `user_assets` remain per-user (not per-workspace) for now.

---

## Migration Strategy
- All existing projects: assign to the auto-created personal workspace for their owner
- Create a personal workspace for every existing user (backfill)
- Set `user_profiles.default_workspace_id` to each user's personal workspace
- Rename `projects.user_id` → `created_by`; backfill `owner_id = created_by` for all existing projects
- No `project_editors` backfill needed — existing owners get implicit access via `owner_id`
- Existing projects with a non-null `slug` are already published — no changes needed
- Existing projects with `slug IS NULL`: remain drafts
- Existing folders: backfill `workspace_id` to the owner's personal workspace (matched via `folders.user_id`), then drop `user_id`

---

## Open TODOs
- [ ] Transfer ownership UX when admin removes a member who owned projects
- [ ] Billing integration — plan check on workspace, seat counting for viewers vs. creators
- [ ] What happens when workspace owner downgrades from Team plan (team workspaces locked/frozen?)
- [ ] Storage quota attribution per workspace
- [ ] Workspace-level settings (branding, default watch policy, etc.)
- [ ] Workspace ownership transfer

---

## Verification
- Write migration SQL and apply to local Supabase
- Test RPC functions via Supabase SQL editor or edge function calls
- Verify: `workspace_get_default` creates a personal workspace on first call for a new user and sets `default_workspace_id`
- Verify: `workspace_get_default` returns personal workspace and heals `default_workspace_id` when stored value is stale/null
- Verify: workspace member can see published workspace projects, non-member cannot
- Verify: project editor can edit, non-editor cannot
- Verify: `project_transfer_owner` updates `owner_id` but leaves `created_by` unchanged
- Verify: member removal cascades project_editors after ownership handoff
- Verify: draft project can be moved between workspaces; published project cannot
- Verify: publish flow generates slug and sets share_policy; subsequent calls raise an error
- Verify: `shared-video-get` enforces workspace watch policy for authed users and blocks unauthed users
- Verify: folder unique name constraint per workspace
- Verify: personal workspace cannot be deleted or have members added
