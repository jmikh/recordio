# Consolidate shared_videos into projects table

## Context
The `shared_videos` table is always 0-or-1 per project and only holds `slug` + `policy`. This is unnecessary indirection — we can move these two columns onto the `projects` table directly and eliminate the joins, the extra table, and the `shared_video_create` RPC.

## Migration

New migration: add `slug` and `share_policy` to `projects`, backfill from `shared_videos`, drop `shared_videos`.

```sql
ALTER TABLE projects ADD COLUMN slug TEXT UNIQUE;
ALTER TABLE projects ADD COLUMN share_policy TEXT NOT NULL DEFAULT 'public'
    CHECK (share_policy IN ('public', 'private'));

-- Backfill existing shares
UPDATE projects p
SET slug = sv.slug, share_policy = sv.policy
FROM shared_videos sv
WHERE sv.project_id = p.id;

-- Drop old table
DROP TABLE shared_videos;
```

A project is "shared" when `slug IS NOT NULL`. No separate boolean needed.

## SQL function changes

### `shared_video_create.sql` → delete
Replace with a new `project_share(p_project_id)` function that:
- Checks ownership (same as today)
- If `slug` already set → return it
- Else generate slug (same `left(replace(gen_random_uuid()::text, '-', ''), 12)`), `UPDATE projects SET slug = ...`, return it

### `project_get.sql`
- Remove the `LEFT JOIN shared_videos` 
- Replace `'is_shared', sv.id IS NOT NULL` → `'is_shared', p.slug IS NOT NULL`
- Replace `'share_slug', sv.slug` → `'share_slug', p.slug`

### `project_list.sql`
- Remove the `LEFT JOIN shared_videos`
- Replace `'is_shared', sv.id IS NOT NULL` → `'is_shared', p.slug IS NOT NULL`

## Edge function changes

### `shared-video-get/index.ts`
- Query `projects` directly instead of `shared_videos` then `projects`
- `from('projects').select('id, name, user_id, share_policy').eq('slug', slug).is('deleted_at', null).maybeSingle()`
- Check `share_policy === 'public'`
- Removes one DB round-trip

### `mux-video-create/index.ts`
- Replace the `shared_videos` existence check with: check `slug IS NOT NULL` on the project row already fetched by the RLS check (combine into one query)

## Frontend changes

### `SettingsPanel.tsx`
- Change `.rpc('shared_video_create', ...)` → `.rpc('project_share', ...)`
- Response shape stays the same (`{ slug, is_new }`)

### No changes needed:
- `VideoPage.tsx` — calls `shared-video-get` edge function with slug, no direct table access
- `cloudStorage.ts` / `cloudProjectService.ts` — don't touch shared_videos

## Files to modify
1. **New migration** — `supabase/migrations/<timestamp>_consolidate_shared_videos.sql`
2. `supabase/sql/functions/shared_video_create.sql` → delete, create `project_share.sql`
3. `supabase/sql/functions/project_get.sql`
4. `supabase/sql/functions/project_list.sql`
5. `supabase/functions/shared-video-get/index.ts`
6. `supabase/functions/mux-video-create/index.ts`
7. `webapp/src/editor/components/settings/SettingsPanel.tsx`
8. Run `supabase/sql/build-functions.sh` to regenerate function migrations

## Verification
1. Run `build-functions.sh` — should produce clean migration files
2. Reset local Supabase DB and apply migrations
3. Test share flow: create project → share → verify slug generated → copy link → visit video page
4. Test re-share: sharing again returns existing slug
5. Test mux-video-create: rejects if project has no slug
