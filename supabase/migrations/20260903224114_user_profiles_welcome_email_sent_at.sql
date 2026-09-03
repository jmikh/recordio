-- Marker for the server's `user_profiles.send-welcome` daily job: set
-- when the welcome email is sent, so scheduler re-runs (every deploy's
-- startup tick re-runs the day's jobs) can never double-send. NULL =
-- not sent; profiles older than the job's 72h window are never
-- selected, so no backfill is needed.
ALTER TABLE public.user_profiles
    ADD COLUMN IF NOT EXISTS welcome_email_sent_at timestamp with time zone;
