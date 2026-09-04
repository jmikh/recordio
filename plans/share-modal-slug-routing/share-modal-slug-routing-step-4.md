# Step 4 — Routing: `/video/{slug}/edit|view` + project-get by slug

- `shared/api/projects.ts`: `ProjectGetRequestSchema { projectId?, slug? }` (project-get only; `ProjectIdRequestSchema` untouched for delete/restore/confirm). `ApiRoutes['project-get']` updated.
- `server/.../projectGet.ts`: 400 if neither param; slug resolves to id first (`SELECT id FROM projects WHERE slug=$1 AND deleted_at IS NULL`), unknown slug → same 403 as no-access; rest unchanged.
- `webapp/src/App.tsx`: `/video/{slug}/edit` → EditorPage (checked BEFORE generic `/video/`); `isPublicRoute` false for the `/edit` form; legacy `/editor` branch kept.
- **New** `webapp/src/lib/videoUrls.ts`: `videoUrl(slug)` (absolute, for copy-link), `editorPath(slug)` / `viewPath(slug)` (relative, for navigate) — replaces the duplicated `VIDEO_BASE_URL` in Header.tsx + ProjectCard.tsx.
- `cloudStorage.ts`: `loadProjectMetadata({ projectId } | { slug })`; `createProjectV2` returns `slug`.
- `cloudProjectService.ts`: `loadProject(ref, onStatus)` → `{ project, name, meta }` (meta = id/owner/workspace/slug/policy/access/editors/ownerName/ownerEmail), keyed internally by `cloudProject.id`; `importRecordingLocalV2` returns `slug`; `ProjectListItem` + mapping gain `workspaceAccess`/`editorRole`.
- **New** `webapp/src/editor/stores/useProjectMetaStore.ts` — share metadata for the editor (Header/ShareModal read it; Step 5).
- `editor/App.tsx`: slug from path, else legacy `projectId` query (redirects to the slug URL after load, `replace: true`); populates the meta store; a 403 on a slug load (view-only user hitting `/edit`) redirects to the view page.
- `DashboardPage.handleOpen`: permission-aware — editor URL when owner / edit grant / workspace-edit share, else view URL.
- `ImportPage`: navigates straight to `/video/{slug}/edit`.
- e2e: `editor.spec.ts` (dashboard-open asserts `/video/{slug}/edit`; legacy-URL test now also proves the redirect), `import.spec.ts` URL regex → `/video/.+/edit`.
