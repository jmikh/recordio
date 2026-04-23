# transcription_usage

Tracks per-user transcription minutes consumed within a billing cycle. The `upsert_transcription_usage` SQL function atomically increments usage and enforces the per-cycle limit. The `rollback_transcription_usage` function decrements usage when a transcription fails. The `reset_date` column determines cycle boundaries — when a new cycle starts, usage resets.

**Accessed by:** `upsert_transcription_usage` SQL function, `rollback_transcription_usage` SQL function, backend `rateLimit.ts`.

**RLS:** Enabled, no user-facing policies (accessed via service-role from backend/SQL functions).
