# Database Functions

## Cron Jobs (`cron_` prefix)

| Function | Schedule | Purpose |
|----------|----------|---------|
| `cron_expire_trials` | Daily | Expires trialing subscriptions past their period end, updates Mixpanel |
| `cron_cleanup_expired_projects` | Daily (midnight UTC) | Soft-deletes projects past their expires_at |

## Edge Function Crons (pg_cron → pg_net → edge function)

| Edge Function | Schedule | Purpose |
|----------|----------|---------|
| `purge-deleted-videos` | Hourly | Deletes queued CF Stream videos from `deleted_videos` table |
| `purge-deleted-projects` | Daily (3 AM UTC) | Hard-deletes projects soft-deleted 3+ days ago, cleans up Storage + CF Stream |

## Triggers

| Function | Event | Purpose |
|----------|-------|---------|
| `handle_new_user` | `auth.users` INSERT | Creates 7-day trial subscription + default storage quota for new signups |

## Backend RPCs

| Function | Called By | Purpose |
|----------|-----------|---------|
| `upsert_transcription_usage` | backend transcription service | Tracks & enforces per-user transcription minute limits |
| `rollback_transcription_usage` | backend transcription service (on error) | Refunds transcription minutes on failure |
| `get_user_storage_bytes` | storage-upload-url edge function | Returns total media bytes used by a user (for quota enforcement) |
| `set_project_expiry` | stripe-webhooks edge function | Sets/clears expires_at on all user projects when subscription changes |
