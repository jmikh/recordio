# Database Functions

## Cron Jobs (`cron_` prefix)

| Function | Schedule | Purpose |
|----------|----------|---------|
| `cron_cleanup_stale_uploads` | Hourly | Moves uploads stuck in 'uploading' for >1h to deletion queue |
| `cron_expire_trials` | Daily | Expires trialing subscriptions past their period end, updates Mixpanel |

## Triggers

| Function | Event | Purpose |
|----------|-------|---------|
| `handle_new_user` | `auth.users` INSERT | Creates 7-day trial subscription for new signups |

## Backend RPCs

| Function | Called By | Purpose |
|----------|-----------|---------|
| `upsert_transcription_usage` | backend transcription service | Tracks & enforces per-user transcription minute limits |
| `rollback_transcription_usage` | backend transcription service (on error) | Refunds transcription minutes on failure |
