# Teams & Workspaces

## Context

Recordio currently has a single-user model — projects are owned by `user_id`, billing is per-user via Stripe, and sharing is view-only via public slug. This plan adds **workspaces** where users can collaborate on projects with team members, with workspace-level billing where the creator pays per-seat.

---

## Database Schema

### New Tables

#### `workspaces`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| name | TEXT NOT NULL | |
| slug | TEXT UNIQUE NOT NULL | URL-friendly identifier |
| owner_id | UUID FK → auth.users | Billing-responsible user |
| stripe_customer_id | TEXT | |
| stripe_subscription_id | TEXT | |
| billing_status | TEXT DEFAULT 'inactive' | active, inactive, past_due, canceled |
| seat_count | INTEGER DEFAULT 1 | Paid seats |
| billing_interval | TEXT | monthly, yearly |
| current_period_end | TIMESTAMPTZ | |
| created_at, updated_at | TIMESTAMPTZ | |

#### `workspace_members`
| Column | Type | Notes |
|--------|------|-------|
| workspace_id | UUID FK → workspaces | Composite PK |
| user_id | UUID FK → auth.users | Composite PK |
| role | TEXT DEFAULT 'member' | owner, admin, member |
| joined_at | TIMESTAMPTZ | |

Index: `idx_workspace_members_user(user_id)`

#### `workspace_invites`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| workspace_id | UUID FK → workspaces | |
| email | TEXT NOT NULL | |
| invited_by | UUID FK → auth.users | |
| role | TEXT DEFAULT 'member' | admin or member |
| token | TEXT UNIQUE | 16-char random for invite link |
| expires_at | TIMESTAMPTZ | 7 days default |
| accepted_at | TIMESTAMPTZ | NULL = pending |

Unique index on `(workspace_id, email) WHERE accepted_at IS NULL` to prevent duplicate pending invites.

#### `project_collaborators` (draft-stage sharing)
| Column | Type | Notes |
|--------|------|-------|
| project_id | UUID FK → projects | Composite PK |
| user_id | UUID FK → auth.users | Composite PK |
| permission | TEXT DEFAULT 'view' | view, edit |
| added_at | TIMESTAMPTZ | |

Index: `idx_project_collaborators_user(user_id)`

### Changes to `projects` Table
```sql
ALTER TABLE projects
    ADD COLUMN workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL,
    ADD COLUMN workspace_visibility TEXT NOT NULL DEFAULT 'draft'
        CHECK (workspace_visibility IN ('draft', 'published'));
```
- `workspace_id IS NULL` → personal project (existing behavior unchanged)
- `workspace_visibility = 'published'` → visible to all workspace members
- `workspace_visibility = 'draft'` → visible only to owner + explicit collaborators

Mirrors the existing `folder_id` pattern.

---

## Access Control

| Action | Owner | Admin | Member |
|--------|-------|-------|--------|
| Rename/delete workspace | ✓ | | |
| Manage billing | ✓ | | |
| Invite members | ✓ | ✓ | |
| Remove members | ✓ | ✓ (not owner) | Self only |
| Change roles | ✓ | | |
| Publish own project | ✓ | ✓ | ✓ |
| View published projects | ✓ | ✓ | ✓ |
| View draft projects | Owner + collaborators only | | |
| Edit project | Project creator + edit collaborators | | |

Key principle: workspace membership grants visibility to published projects. Project mutation remains gated by `project.user_id` or explicit collaborator `edit` permission.

---

## Billing Model

**Per-seat pricing with workspace-level subscription.**

- Workspace owner subscribes to a "Team" plan (separate Stripe price IDs).
- `seat_count` tracks paid seats. Inviting beyond requires increasing Stripe quantity.
- All workspace members inherit Pro features through workspace membership (no individual sub needed).
- `hasProAccess()` extended: `individual sub active OR trial active OR member of workspace with active billing`.
- Personal free 5-project cap only counts projects where `workspace_id IS NULL`. Workspace projects are unlimited (governed by workspace plan).

---

## Project Visibility Model

```
Personal (workspace_id IS NULL):
  → Visible only to owner (existing behavior)
  → Public sharing via slug still works

Workspace + draft:
  → Visible to: project owner + explicit collaborators
  → Collaborators must be members of the same workspace

Workspace + published:
  → Visible to: ALL workspace members (read-only)
  → Editable by: project owner + collaborators with 'edit' permission
  → Can also have a public slug (orthogonal)
```

---

## RPC Functions

### Workspace CRUD
- `workspace_create(p_name)` → creates workspace + adds caller as owner
- `workspace_get(p_workspace_id)` → returns details (member-only)
- `workspace_list()` → all workspaces caller belongs to
- `workspace_update(p_workspace_id, p_name)` → owner/admin only
- `workspace_delete(p_workspace_id)` → owner only, sets projects' workspace_id to NULL

### Member Management
- `workspace_member_list(p_workspace_id)` → members with roles + names
- `workspace_member_remove(p_workspace_id, p_user_id)` → owner/admin can remove; members remove self
- `workspace_member_update_role(p_workspace_id, p_user_id, p_role)` → owner only

### Project-Workspace Operations
- `workspace_project_list(p_workspace_id)` → published projects + drafts where caller is owner/collaborator
- `workspace_project_publish(p_project_id)` → sets workspace_visibility = 'published'
- `workspace_project_unpublish(p_project_id)` → reverts to 'draft'
- `workspace_project_move(p_project_id, p_workspace_id)` → moves personal project into workspace (or NULL to move back)

### Draft Collaborators
- `project_collaborator_add(p_project_id, p_user_id, p_permission)` → owner adds workspace member as collaborator
- `project_collaborator_remove(p_project_id, p_user_id)`
- `project_collaborator_list(p_project_id)`

---

## Edge Functions

### New
- **`workspace-invite`** — validates caller is owner/admin, checks seat limits, creates invite, sends email via Resend
- **`workspace-invite-accept`** — validates token, inserts workspace_member, updates Stripe seat quantity
- **`workspace-billing-checkout`** — creates Stripe checkout for workspace (team price ID, quantity = seats)
- **`workspace-billing-portal`** — Stripe portal for workspace billing

### Modified
- **`stripe-webhooks`** — add workspace subscription event handling (check for workspace_id in metadata)
- **`_shared/auth.ts`** — extend `hasProAccess()` to check workspace billing status
- **`project-create`** — accept optional `workspace_id` param to associate at creation

---

## RLS Policies (Defense-in-Depth)

Added on new tables + extended on `projects`:
- Workspace members can SELECT workspaces they belong to
- Owner can UPDATE workspace
- Members can see other members in their workspace
- Workspace members can SELECT published workspace projects
- Collaborators can SELECT draft projects they're added to
- Project owner manages project_collaborators entries

Existing `projects` RLS policies unchanged (user_id = auth.uid() for own projects).

---

## Migration Strategy

All changes are **additive** — nothing breaks for existing users:

1. **Schema migration** — new tables + nullable columns on projects
2. **RPC functions** — new functions via `sql/deploy.sh` (existing RPCs unchanged)
3. **Edge functions** — new endpoints + modifications to stripe-webhooks and auth helper
4. **Client** — workspace selector, team dashboard view, invite UI

### Edge Cases
- **Member leaves** → their projects stay in workspace (still owned by them), they lose visibility to others' published projects
- **Workspace billing canceled** → members lose Pro access (unless they have individual sub), workspace features disabled
- **User in multiple workspaces** → Pro if ANY workspace has active billing. Projects belong to exactly one workspace (or personal)

---

## Files to Create/Modify

### Create
- `supabase/migrations/YYYYMMDD_workspaces.sql` — schema + RLS
- `supabase/sql/functions/workspace_*.sql` — all workspace RPCs
- `supabase/sql/functions/project_collaborator_*.sql` — collaborator RPCs
- `supabase/functions/workspace-invite/index.ts`
- `supabase/functions/workspace-invite-accept/index.ts`
- `supabase/functions/workspace-billing-checkout/index.ts`
- `supabase/functions/workspace-billing-portal/index.ts`

### Modify
- `supabase/functions/stripe-webhooks/index.ts` — workspace subscription events
- `supabase/functions/_shared/auth.ts` — `hasProAccess()` workspace check
- `supabase/functions/project-create/index.ts` — optional workspace_id param
- `webapp/src/editor/stores/useUserStore.ts` — workspace state
- `webapp/src/components/DashboardSidebar.tsx` — workspace navigation
- `webapp/src/pages/DashboardPage.tsx` — workspace project list view

---

## Verification

1. Create workspace → verify RPC returns workspace with caller as owner
2. Invite member → verify email sent, token works, member added
3. Move project to workspace → verify workspace_project_list includes it
4. Publish project → verify other members can see it via workspace_project_list
5. Add collaborator to draft → verify they see it, non-collaborators don't
6. Workspace billing checkout → verify all members get Pro access
7. Existing personal projects → verify no behavior change (project_list unchanged)
