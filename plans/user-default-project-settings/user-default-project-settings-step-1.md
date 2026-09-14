# Step 1 — Backend + contract

**Parent:** [`user-default-project-settings-tiered-plan.md`](user-default-project-settings-tiered-plan.md) §3.1–3.2
**Started:** 2026-09-13

## Goal

Persist a per-user `{ schemaVersion, settings }` blob and expose get / set / clear
routes, following the Fastify + `shared/api` contract pattern. Nothing is seeded:
`user_profiles.project_defaults` stays NULL until a user saves. Deployable on its own
with zero behavior change.

## Work

1. **Migration** `supabase/migrations/<ts>_user_profiles_project_defaults.sql` —
   `ADD COLUMN IF NOT EXISTS project_defaults JSONB`, comment explains NULL semantics.
   Applied locally only (`supabase migration up`). DDL snapshot
   `supabase/sql/tables/user_profiles.sql` hand-updated.
2. **Contract** `shared/api/session.ts`: `StoredProjectDefaults`,
   `UserProjectDefaultsSetRequestSchema` (+ `Static` type), the two response interfaces;
   `shared/api/index.ts`: three `ApiRoutes` entries.
3. **Routes** `server/src/routes/userProjectDefaults{Get,Set,Clear}.ts`, registered in
   `server/src/app.ts` after `userReviewSetRoutes`. Set has a 64 KB `bodyLimit` and a
   TypeBox body schema; get has no response schema (jsonb blob).
4. **Tests** `server/test/userProjectDefaults.test.ts` — auth/no-db tier (401, 400, 413)
   and the real-Postgres tier (null for fresh users, round-trip incl. unknown keys,
   replace, caller scoping, clear, no-profile-row upsert, no leak into
   `/user-profile-get`).

## Decisions

- Column on `user_profiles`, not a table (one blob per user; precedent
  `default_workspace_id`, `reviewed_at`; RLS-on/no-policies posture unchanged).
- Schema version stored alongside so the settings sub-tree rides the existing project
  migrations.
- 400 tests avoid Ajv-coercible values (`"6"` would coerce to 6); they use `0`,
  a string for `settings`, and missing keys.

## Verification

```bash
supabase migration up                                  # local DB only
npx vitest run server/test/userProjectDefaults.test.ts # root vitest → .env.test → real Postgres tier
npx vitest run server/test/userProfileGet.test.ts server/test/userReviewSet.test.ts
(cd server && npm run typecheck)
```

## Files changed

- `supabase/migrations/20260913183022_user_profiles_project_defaults.sql` (new; applied locally)
- `supabase/sql/tables/user_profiles.sql` (snapshot: `project_defaults JSONB`)
- `shared/api/session.ts` (`StoredProjectDefaults`, `UserProjectDefaultsSetRequestSchema`, responses; first `shared/api` file to `import type` from `shared/types` — server typecheck stays clean)
- `shared/api/index.ts` (three `ApiRoutes` entries)
- `server/src/routes/userProjectDefaultsGet.ts`, `userProjectDefaultsSet.ts`, `userProjectDefaultsClear.ts` (new)
- `server/src/app.ts` (imports + registration)
- `server/test/userProjectDefaults.test.ts` (new, 9 tests)

**Completed 2026-09-13.** `supabase migration up` (local), server typecheck clean, 9/9 new tests + sibling user-profile suites green.
