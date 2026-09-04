# Step 2 — Individual grant routes

New owner-only routes managing `project_editors` (nothing inserted into that table before this step).

## Routes

- **POST /project-editor-set** `{ projectId, userId, role }` — upsert a grant.
  Checks in order: project exists + live (404) → caller is owner (403, same wording family as project-share) → target ≠ owner (400 `Owner already has access`) → target is a live workspace member via `isWorkspaceMember` (400 `User is not a member of this workspace`) → workspace entitlements `canShare` (403 `subscription_required` — granting access IS sharing). Upsert `ON CONFLICT (project_id, user_id) DO UPDATE SET role`.
- **POST /project-editor-remove** `{ projectId, userId }` — delete a grant. Owner-only; idempotent; NO entitlement gate (un-sharing must always work, parity with private policy).
- Both respond `{ editors: [...] }` — the refreshed list in the project-get shape (`user_id, email, name, role`), via a new `listProjectEditors` helper in `projectAccess.ts` (same join as projectGet's subquery).

## Files

- `shared/api/projects.ts`: `ProjectEditorSetRequestSchema`, `ProjectEditorRemoveRequestSchema`, `ProjectEditorsResponseSchema` (+ types); `shared/api/index.ts`: map both routes.
- `server/src/services/projectAccess.ts`: `listProjectEditors`.
- New `server/src/routes/projects/projectEditorSet.ts`, `projectEditorRemove.ts`; register in `server/src/app.ts` beside projectShareRoutes.
- Tests: new `server/test/projects/projectEditors.test.ts` (validation tier + e2e tier, patterns from projectShare.test.ts).
