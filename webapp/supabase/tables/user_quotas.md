# user_quotas

Per-user storage and project limits. Auto-created by `handle_new_user()` trigger with defaults. Configurable per-user by support.

## Columns

| Column | Purpose |
|--------|---------|
| `user_id` | PK, FK to auth.users |
| `storage_limit_bytes` | Max bytes allowed (default 25 GB) |
| `max_projects` | Max number of projects allowed (default 50) |

## Accessed by

- `storage-upload-url` edge function — reads limit for quota enforcement
- `cloudStorage.ts` (webapp) — reads for UI display

## RLS

- SELECT: `auth.uid() = user_id`
