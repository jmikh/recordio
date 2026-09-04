# Share Modal + Access Model (view/edit) + Always-On Slugs + `/video/{slug}/edit|view`

## Context

Today the editor header has a "Publish" button that immediately generates a share slug, copies the link, and fires a Mux render — no settings UI. The user wants a Loom-style flow: the button becomes **"Share"** and opens a modal with real access controls. Only the project owner can change settings (already enforced at [projectShare.ts:57-59](server/src/routes/projects/projectShare.ts#L57-L59)). Routing also changes so **every project always has a slug** and URLs become `/video/{slug}/edit` (editor) and `/video/{slug}` or `/video/{slug}/view` (viewer, default view). Workspace visibility must be enforced on the video page (today [sharedVideoGet.ts](server/src/routes/sharedVideoGet.ts) serves only `share_policy === 'public'`, no auth).

### Confirmed decisions
- **Access model (two-part)**: `share_policy` ∈ private | workspace | public, PLUS `workspace_access` ∈ view | edit that applies whenever policy is workspace **or** public (public = link viewable by anyone AND workspace gets its access level; "public adds workspace").
- **Individual shares**: owner can grant specific **workspace members** (no external emails) per-person **view** or **edit** on a project. `project_editors` gains a `role` column.
- **Override rule**: policy giving workspace *view* (workspace/public + access=view) erases individual **view** grants; workspace *edit* erases **all** individual grants (all redundant). Setting private erases nothing.
- **Shared-with-you tag**: projects granted to you individually (not via workspace) already appear in dashboard "Your Videos" ([DashboardPage.tsx:52-56](webapp/src/pages/dashboard/DashboardPage.tsx#L52-L56)); add a "Shared with you" tag on those cards.
- **Modal scope**: visibility + workspace access level + invite workspace members + who-has-access list (with per-person role dropdown/remove) + creator row + Copy link. NO email/embed tabs, NO viewer settings.
- **Non-owners**: see the Share button, modal opens **read-only** ("Only the owner can change share settings"), Copy link enabled.
- **Free tier**: hard Pro gate — Share button opens `ProUpgradeModal` directly (like today).
- **Mux publish sync**: automatic — fire `mux-video-create` (idempotent per `(project_id, cloud_version)`) when policy leaves private and on each Copy link click. No explicit update button.
- **Plan type: tiered** → on implementation start, create `plans/share-modal-slug-routing/share-modal-slug-routing-tiered-plan.md` (per planning skill) mirroring this design + step list; per-step docs as each step begins; keep the Step log updated.

### Verified current state
- `share_policy` is **nullable, no default**; drafts are `slug NULL, policy NULL` ([workspace_infrastructure.sql:81-90](supabase/migrations/20260511182449_workspace_infrastructure.sql#L81-L90)). All RLS policies dropped (`20260513194112`) — enforcement is server-side only.
- `is_shared` is `p.slug IS NOT NULL` in [projectGet.ts:56](server/src/routes/projects/projectGet.ts#L56) / [projectList.ts:52](server/src/routes/projects/projectList.ts#L52) — breaks once slugs are universal.
- `project_editors` (project_id, user_id) rows are today's edit grants; **nothing inserts into it** (only SELECTs in [projectAccess.ts](server/src/services/projectAccess.ts), [projectList.ts](server/src/routes/projects/projectList.ts), [projectGet.ts](server/src/routes/projects/projectGet.ts) and a DELETE in [workspaceMemberRemove.ts:80](server/src/routes/workspaces/workspaceMemberRemove.ts#L80)) — grant-management routes are net-new.
- Routing is a custom pathname dispatch in [webapp/src/App.tsx:21-76](webapp/src/App.tsx#L21-L76) (not React Router); editor is `/editor?projectId={uuid}`; `isPublicRoute()` treats all `/video/` as public.
- Header double-fetches `project-get` for the slug ([Header.tsx:98-104](webapp/src/editor/components/header/Header.tsx#L98-L104)) — remove.
- `invokeFunction` attaches the bearer token whenever a session exists (works on public VideoPage).
- `mux-video-create` is idempotent per `(project_id, cloud_version)`; `cloud_version` bumps only on real edits.
- Dashboard sections: "Your Videos" = owned or `isEditor`; "Workspace" = policy workspace/public; Trash = own.

## Design

**Schema**
- `projects.slug`: DB default `left(replace(gen_random_uuid()::text,'-',''),12)`, backfill NULLs (collision-retry loop; unique index `projects_slug_key` exists), then NOT NULL.
- `projects.share_policy`: backfill `NULL → 'private'`, then `DEFAULT 'private' NOT NULL` (CHECK already allows the 3 values).
- `projects.workspace_access text NOT NULL DEFAULT 'view' CHECK (workspace_access IN ('view','edit'))`.
- `project_editors.role text NOT NULL DEFAULT 'edit' CHECK (role IN ('view','edit'))` — existing rows correctly become edit grants.
- `is_shared := share_policy IN ('public','workspace')` everywhere (individual grants don't flip it).

**Permissions (single source: [projectAccess.ts](server/src/services/projectAccess.ts))**
- *Edit* (`canEditProject`, already used by project-get/update/etc. — semantics ripple automatically): owner OR `project_editors.role='edit'` OR (policy ≠ private AND `workspace_access='edit'` AND workspace member).
- *View* (new `canViewProject` for sharedVideoGet): public → anyone; policy workspace → workspace member; private → owner or any `project_editors` row; an individual grant (either role) always grants view regardless of policy.

**project-share route** ([projectShare.ts](server/src/routes/projects/projectShare.ts)): request becomes `{ projectId, sharePolicy?, workspaceAccess? }`. Owner-only + entitlements as today, but allow `sharePolicy:'private'` without `canShare` (expired-trial owners must be able to un-share). After UPDATE, apply the override rule in the same transaction: policy ∈ (workspace, public) → `DELETE FROM project_editors WHERE role='view'` (and `WHERE true` when `workspace_access='edit'`).

**Grant routes (new, owner-only, target must be a live workspace member of the project's workspace)**
- `project-editor-set` `{ projectId, userId, role }` — upsert into `project_editors`.
- `project-editor-remove` `{ projectId, userId }`.
- Both return the refreshed editors list. Register alongside existing project routes; schemas in [shared/api/projects.ts](shared/api/projects.ts) + `shared/api/index.ts`.

**Routing**: dispatch regex `^\/video\/([^/]+)(?:\/(edit|view))?\/?$` — `edit` → EditorPage (auth, NOT public), else VideoPage. `/editor?projectId=` keeps working (editor loads → `navigate` to `/video/{slug}/edit`, `replace: true`). Copied links stay short `/video/{slug}`. `project-get` accepts `{ projectId } | { slug }` (new request schema; leave `ProjectIdRequestSchema` alone — shared by delete/restore); resolve id first, then existing checks. Editor load 403 (view-only user hitting `/edit`) → redirect to `/video/{slug}`.

**sharedVideoGet**: new `optionalUser` preHandler in [server/src/plugins/auth.ts](server/src/plugins/auth.ts) (extract JWT verify from `requireUser`; sets `req.user` if valid, never 401s). Unauthenticated + non-public → `403 { error: 'auth_required' }` (VideoPage shows sign-in via [AuthModal](webapp/src/auth/AuthModal.tsx), re-fetches after auth); authenticated without access → 404. Keep 60/min rate limit.

## Steps

### Step 1 — Migration + share-model server changes
- **New migration** `supabase/migrations/<date -u '+%Y%m%d%H%M%S'>_share_access_model.sql` (timestamp generated at creation, must sort last per `supabase/migrations/CLAUDE.md`): all Schema items above.
- [projectCreateV2.ts](server/src/routes/projects/projectCreateV2.ts): `RETURNING slug`; add `slug` to 200 response schema.
- [projectGet.ts](server/src/routes/projects/projectGet.ts) / [projectList.ts](server/src/routes/projects/projectList.ts): new `is_shared` derivation; both return `workspace_access`; list adds `editor_role` (caller's grant role or null; keep `is_editor` for compat); get's `editors` subquery gains `role`, plus `owner_name`/`owner_email` (reuse the `auth.users`/`user_profiles` join pattern from the editors subquery).
- [projectShare.ts](server/src/routes/projects/projectShare.ts): two-part request, private-without-canShare, override-rule deletes (transactional).
- [projectAccess.ts](server/src/services/projectAccess.ts): `canEditProject` new semantics; add `canViewProject`.
- [shared/api/projects.ts](shared/api/projects.ts): `WorkspaceAccessSchema` (view|edit); `ProjectShareRequestSchema` + `CloudProject`/`CloudProjectSummary`/`ProjectEditor` updates.
- Tests: `projectShare.test.ts` (two-part updates, stable slug, override-rule deletions, private-without-subscription), `projectCreateV2.test.ts` (slug returned), `projectGet/List.test.ts` (derivations, roles, owner fields), `projectAccess` coverage via existing route tests (workspace-edit member can update). Audit `slug: null` seeds in `server/test/helpers/db.ts`.

### Step 2 — Individual grant routes
- **New** `server/src/routes/projects/projectEditorSet.ts` + `projectEditorRemove.ts` (owner-only; validate target is a member of the project's workspace; upsert/delete; return editors list).
- Tests mirroring `projectShare.test.ts` patterns: owner-only 403, non-member target 400/404, upsert role change, remove, editors list shape.

### Step 3 — sharedVideoGet enforcement + VideoPage auth UX
- [auth.ts](server/src/plugins/auth.ts): `optionalUser`. [sharedVideoGet.ts](server/src/routes/sharedVideoGet.ts): SELECT `workspace_id, workspace_access`; use `canViewProject`; 403 `auth_required` in schema.
- [VideoPage.tsx](webapp/src/pages/VideoPage.tsx): 403 → "Sign in to view this video" + AuthModal, re-fetch on auth.
- Tests: matrix over {public, workspace(view/edit), private} × {anon, owner, editor(view), editor(edit), member, non-member}.

### Step 4 — Routing: `/video/{slug}/edit` + project-get by slug
- [shared/api/projects.ts](shared/api/projects.ts) + `shared/api/index.ts`: `ProjectGetRequestSchema { projectId?, slug? }`; [projectGet.ts](server/src/routes/projects/projectGet.ts) resolves either (400 if neither). Tests: by-slug owner/editor, outsider 403, neither 400.
- [webapp/src/App.tsx](webapp/src/App.tsx): new dispatch; `isPublicRoute` excludes `/edit`.
- `cloudStorage.ts` `loadProjectMetadata` + [cloudProjectService.ts](webapp/src/storage/cloudProjectService.ts) `loadProject`: accept `{ projectId } | { slug }`, use `cloudProject.id` internally, return share metadata (`id, ownerId, workspaceId, slug, sharePolicy, workspaceAccess, editors, ownerName, ownerEmail`).
- **New** `webapp/src/editor/stores/useProjectMetaStore.ts` (zustand): that metadata + setters for policy/access/editors.
- [webapp/src/editor/App.tsx](webapp/src/editor/App.tsx): parse slug from path, else legacy query; populate meta store; legacy URL → `replace` navigate; 403 → redirect to view page.
- **New** `webapp/src/lib/videoUrls.ts`: `videoUrl(slug)` / `editorUrl(slug)`; replaces `VIDEO_BASE_URL` copies in [Header.tsx:53-55](webapp/src/editor/components/header/Header.tsx#L53-L55) / [ProjectCard.tsx:10-12](webapp/src/pages/dashboard/ProjectCard.tsx#L10-L12).
- [DashboardPage.tsx](webapp/src/pages/dashboard/DashboardPage.tsx) + [ImportPage.tsx:217](webapp/src/pages/import/ImportPage.tsx#L217): navigate by **permission** — editor URL when caller can edit (owner / `editorRole==='edit'` / workspace edit), else view URL. `ProjectListItem` gains `workspaceAccess`, `editorRole`.
- e2e: `e2e/tests/editor.spec.ts` URL assertions; check `import.spec.ts`/`auth-gate.spec.ts` for `/editor` references.

### Step 5 — Share modal UI + header swap + dashboard tags
- **New** `webapp/src/editor/components/header/ShareModal.tsx` — per ui-guidelines (semantic tokens, `Modal`/`Button`/`Dropdown`/`Tooltip`/`XButton` from `@shared/components`, `heading-2` title, dialog aria-label, no raw buttons, icon-sm/md classes):
  - Title `Share "{projectName}"`.
  - **Invite people**: typeahead over workspace members (reuse the members data source used by [MembersSection.tsx](webapp/src/pages/settings/MembersSection.tsx) / workspace-get), excluding owner + already-granted; picking one calls `project-editor-set` (default Can view, role selectable).
  - **Who has access**: link row (visibility dropdown Private / Everyone in workspace / Anyone with the link); workspace row with Can view | Can edit dropdown (visible when policy ≠ private) → `project-share { workspaceAccess }`; individual rows (avatar initials — pattern at VideoPage.tsx:137-139 — name/email, role dropdown, XButton remove); creator row (muted "Creator"). Optimistic updates against `useProjectMetaStore`, revert + toast on error. Warn-on-change: when a policy change will erase grants, confirm inline (e.g. "This removes N individual shares").
  - Footer: full-width primary **Copy link** (`videoUrl(slug)`, toast; fires mux per design — reuse fire-and-forget + `captureError` pattern from Header.tsx:134-138; keep pending-uploads guard, and fire on private→shareable transitions too).
  - Non-owner: everything disabled + note; Copy link enabled. Syncing: controls disabled with "Syncing to cloud..." tooltip.
- [Header.tsx](webapp/src/editor/components/header/Header.tsx): drop `project-get` effect/`shareSlug`/publish split-button (~321-360); Share `Button` opens modal (free tier → `ProUpgradeModal`, hard gate). Keep `trackPublish*` from new call sites; add `trackShareModalOpened`.
- [ProjectCard.tsx](webapp/src/pages/dashboard/ProjectCard.tsx): Copy-link only when policy shareable, else "Private" label (every project has a slug now); **"Shared with you"** tag when `ownerId !== userId && editorRole` (text-badge styling).
- e2e: share modal open, role dropdowns by accessible label.

### Step 6 — Cleanup + docs
- `plans/share-modal-slug-routing/share-modal-slug-routing-agent-suggestions.md`: dead base-schema SQL fns (`project_get`/`project_list`/`project_share`) → graveyard candidates; vacuous `if (!access.slug)` in muxVideoCreate.ts:109; `project_editors` table name now misleading (holds view grants too).
- Update `webapp/src/storage/cloudProjectService.test.ts`; final Step-log update in the tiered plan doc.

## Verification
- **Server**: `cd server && npm test` (DB suites need `supabase start`); patterns from `server/test/projects/projectShare.test.ts`, `server/test/sharedVideoGet.test.ts`, seeds via `server/test/helpers/db.ts`.
- **Migration**: apply locally; existing projects get slugs, `private` policy, `view` access; existing `project_editors` rows read role `edit`.
- **e2e**: `/video/{slug}/edit` opens editor; legacy `/editor?projectId` redirects; `/video/{slug}` public route, `/edit` auth-gated.
- **Manual**: owner grants a member Can view → member sees card tagged "Shared with you", card opens view page, video page plays; upgrade grant to Can edit → card opens editor; set workspace Can edit → individual grants disappear from modal; signed-out workspace video → sign-in prompt → plays; free tier → upgrade modal; non-owner → read-only modal.

## Risks
- **Deploy ordering**: migration is safe under old server code (DB defaults), but old webapp shows Copy-link on drafts (keys off slug) — ship Step 5's ProjectCard change in the same release or accept a brief window.
- `canEditProject` broadening (workspace_edit) automatically affects every route using it (update/delete-adjacent paths) — intended, but tests must pin owner-only routes (delete/restore/share) stay owner-only.
- Override-rule deletes are destructive and silent server-side — modal shows the inline warning; log deletions (`req.logCtx`).
- `isNew`/"Republish" analytics semantics change silently; `trackPublish*` continues from new call sites.
