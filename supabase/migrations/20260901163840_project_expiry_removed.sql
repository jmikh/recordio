-- Billing revamp Step 4: the 14-day project expiry is replaced by the
-- active-project cap (enforced in /project-create-v2). Nothing has
-- enforced expiry since the cleanup cron was dropped (graveyard,
-- 2026-07-18) — null the stale timestamps so no client ever renders a
-- false countdown again. The column itself is dropped in Step 8, after
-- no deployed server references it.
UPDATE public.projects SET expires_at = NULL WHERE expires_at IS NOT NULL;
