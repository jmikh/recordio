# user_assets

Global custom assets library (backgrounds, music). Tracks metadata for files stored in the `project-media/{user_id}/assets/` bucket path.

## Columns

| Column | Purpose |
|--------|---------|
| `id` | Client-generated ID (e.g. `bg-uuid`, `music-uuid`) |
| `asset_type` | `'background'` or `'music'` |
| `storage_path` | Path in Supabase Storage bucket |
| `name` | Display name (for music files) |
| `size_bytes` | File size for quota tracking |

## Accessed by

- `cloudStorage.ts` (webapp) — CRUD via RLS

## RLS

- Full CRUD: `auth.uid() = user_id`
