# Share Modal + Access Model (view/edit) + Always-On Slugs + `/video/{slug}/edit|view`

## Context

The editor header's "Publish" button immediately generates a share slug, copies the link, and fires a Mux render — no settings UI. This plan replaces it with a **"Share"** button opening a Loom-style modal with real access controls. Only the project owner can change share settings (already enforced at `server/src/routes/projects/projectShare.ts`). Routing changes so **every project always has a slug** and URLs become `/video/{slug}/edit` (editor) and `/video/{slug}` or `/video/{slug}/view` (viewer, default view). "Everyone in workspace" visibility becomes actually enforced on the video page (today `sharedVideoGet.ts` serves only `share_policy === 'public'`, no auth).

## Design

### Access model (two-part, confirmed with user)
- `projects.share_policy` ∈ `private | workspace | public`, PLUS `projects.workspace_access` ∈ `view | edit` that applies whenever policy is workspace **or** public (public = link viewable by anyone AND workspace gets its access level).
- **Individual shares**: owner grants specific **workspace members** (no external emails) per-person `view` or `edit`. `project_editors` gains a `role` column (existing rows become `edit` — correct, they were edit grants).
- **Override rule**: a policy change giving workspace *view* (workspace/public + access=view) erases individual **view** grants; workspace *edit* erases **all** individual grants. Setting private erases nothing.
- `is_shared := share_policy IN ('public','workspace')` everywhere (was `slug IS NOT NULL`; breaks once slugs are universal). Individual grants don't flip it.

### Schema changes (one migration)
- `projects.slug`: DB default `left(replace(gen_random_uuid()::text,'-',''),12)`, backfill NULLs (collision-retry; unique index `projects_slug_key` exists), then NOT NULL.
- `projects.share_policy`: backfill `NULL → 'private'`, then `DEFAULT 'private' NOT NULL`.
- `projects.workspace_access text NOT NULL DEFAULT 'view' CHECK (view|edit)`.
- `project_editors.role text NOT NULL DEFAULT 'edit' CHECK (view|edit)`.

### Permissions (single source: `server/src/services/projectAccess.ts`)
- *Edit* (`canEditProject`, used by project-get/update/etc. — semantics ripple automatically): owner OR `project_editors.role='edit'` OR (policy ≠ private AND `workspace_access='edit'` AND workspace member).
- *View* (new `canViewProject` for sharedVideoGet): public → anyone; workspace → workspace member; private → owner or any `project_editors` row; an individual grant (either role) always grants view.
- Owner-only routes (share settings, grant management, delete/restore) stay owner-only — pinned by tests.

### Routes
- `project-share`: request `{ projectId, sharePolicy?, workspaceAccess? }`; allow `'private'` without `canShare` (expired-trial owners must be able to un-share); apply override-rule deletes transactionally.
- New `project-editor-set` `{ projectId, userId, role }` (upsert) and `project-editor-remove` `{ projectId, userId }` — owner-only, target must be a live member of the project's workspace; return refreshed editors list.
- `project-get`: accepts `{ projectId } | { slug }`; editors gain `role`; adds `owner_name`/`owner_email`.
- `sharedVideoGet`: new `optionalUser` preHandler; policy ladder via `canViewProject`; unauthenticated + non-public → `403 { error: 'auth_required' }`; authenticated without access → 404.

### Frontend
- Custom dispatch in `webapp/src/App.tsx` gains `^\/video\/([^/]+)(?:\/(edit|view))?\/?$` — `edit` → EditorPage (auth, NOT public), else VideoPage. Legacy `/editor?projectId=` keeps working (editor loads → replace-navigate to `/video/{slug}/edit`). Copied links stay short `/video/{slug}`.
- New `useProjectMetaStore` (ownerId, workspaceId, slug, sharePolicy, workspaceAccess, editors, ownerName, ownerEmail) populated on project load; Header's redundant `project-get` effect removed.
- New `webapp/src/lib/videoUrls.ts` (`videoUrl`/`editorUrl`) replacing duplicated `VIDEO_BASE_URL`.
- ShareModal (owner: visibility dropdown, workspace Can view|Can edit, invite workspace members, per-person role/remove, Copy link; non-owner: read-only + Copy link; free tier: hard Pro gate — button opens ProUpgradeModal).
- Mux sync automatic: fire `mux-video-create` (idempotent per cloud version) on private→shareable transition and on Copy link.
- Dashboard: card navigation by permission (editor URL only when caller can edit); "Shared with you" tag when `ownerId !== userId && editorRole`; Copy-link on card only when policy shareable, else "Private" label.

## Steps

1. **Migration + share-model server changes** — schema migration; `is_shared` re-derivation; projectCreateV2 returns slug; project-share two-part + override deletes; canEditProject/canViewProject; shared API types; test updates.
2. **Individual grant routes** — `project-editor-set` / `project-editor-remove` + tests.
3. **sharedVideoGet enforcement + VideoPage auth UX** — optionalUser, policy ladder, sign-in prompt on 403.
4. **Routing** — `/video/{slug}/edit|view` dispatch, project-get by slug, meta store, URL helpers, permission-aware navigation, legacy redirect.
5. **Share modal UI** — ShareModal component, header swap, dashboard tags/labels.
6. **Cleanup + docs** — agent-suggestions entries, remaining test updates, final step log.

## Risks
- **Deploy ordering**: migration is safe under old server code (DB defaults cover inserts), but old webapp shows Copy-link on drafts (keys off slug) — ship Step 5's ProjectCard change in the same release or accept a brief window.
- `canEditProject` broadening (workspace_edit) affects every route using it — intended; owner-only routes pinned by tests.
- Override-rule deletes are destructive and silent server-side — modal warns inline; deletions logged via `req.logCtx`.
- `isNew`/"Republish" analytics semantics change silently; `trackPublish*` continues from new call sites.

## Step log
- Step 1 — completed 2026-09-04. Design changes: added `share.policy` / `share.removed_editors` to the typed logging schema (`server/src/logging.ts`); removed the muxVideoCreate "no slug → 400" test (state unrepresentable post-migration; the route's slug gate flagged for Step 6 cleanup); the update+override-delete runs as one atomic CTE (no transaction surface on the pooled db). Note: webapp `cloudProjectService.test.ts > saveProject > passes expected version` fails pre-existing (unrelated uncommitted work).
- Step 2 — completed 2026-09-04. No design changes. (`listProjectEditors` helper added to projectAccess.ts; set route also rejects granting to the owner, 400.)
- Step 3 — completed 2026-09-04. No design changes. (VideoPage re-fetches by depending on `isAuthenticated`; 403 detection via `FunctionsHttpError.context.status` — no body parse needed since 403 on this route is always auth_required.)
- Step 4 — completed 2026-09-04. Design changes: ImportPage navigates straight to `/video/{slug}/edit` (slug threaded through createProjectV2/importRecordingLocalV2) instead of relying on the legacy redirect; `loadProjectMetadata` takes a `{ projectId } | { slug }` ref (cast to ProjectGetRequest — the union defeats the typed invokeFunction overload); meta store holds the whole `ProjectShareMeta` object rather than flat fields.
- Step 5 — completed 2026-09-04. Design changes: the workspace-access row shows whenever policy ≠ private (including policy='workspace' — slightly redundant with the visibility dropdown but matching the reference design); grant-erasing changes confirm inline before applying; the Mux update also fires on Copy link for edit-capable collaborators, not only the owner; the Share button keeps the hard Pro gate (canShare=false → ProUpgradeModal directly).
- Step 6 — completed 2026-09-04. Agent-suggestions doc written (dead SQL fns, vacuous mux slug gate, project_editors naming, seat-billing interaction of edit grants to viewer-role members, Dropdown disabled prop, stale edge-function integration tests).
- Modal polish — 2026-09-04, user feedback from live testing. Removed the grant-erase confirmation (override rule applies immediately, optimistic); invite control is the shared `Dropdown` over addable members (replacing the hand-rolled typeahead) — disabled with "Everyone in the workspace already has edit access" under workspace-edit; per-editor "Can view" option disabled whenever the workspace already grants view; viewer-role members hidden from the invite picker under workspace-view (nothing left to grant them); invite default role becomes 'edit' when workspace already has view. ui-guidelines skill gained the "never hand-roll dropdowns" rule (user-approved skill edit).
- Modal polish 2 — 2026-09-04. Workspace-edit invite message became a Tooltip on the disabled picker (pointer-events-none on the child so the wrapper gets hover); per-editor removal moved from XButton into the role dropdown as a red `destructive` "Remove" option at the bottom.
- Suggestions applied — 2026-09-04, on user request. Design changes: viewer-role workspace members are now excluded from workspace-edit access AND cannot receive individual edit grants (seat-billing guard — `EDIT_ACCESS_SQL` + project-editor-set 400); mux-video-create's unreachable slug gate removed; Dropdown gained `disabled` and the ShareModal read-only state uses disabled dropdowns instead of static text; stale `test/integration/{edge-functions,supabase-rpc}.test.ts` + orphaned mock helpers deleted (README updated). Item 1 (graveyard) verified already covered; item 3 (project_editors rename) deliberately skipped.
