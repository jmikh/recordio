-- Remove the mux_videos soft-delete machinery (user decision 2026-07-22).
--
-- Nothing in the codebase ever set is_deleted = true, and the partial
-- unique index idx_mux_videos_one_active_completed (one non-deleted
-- completed row per project) deadlocked re-publishing: a second
-- version's video.asset.ready violated the index, the Mux webhook
-- 500'd forever, and the purge could never break the tie (its
-- candidates must sit below the highest COMPLETED version — v2 never
-- completed). Purging mux videos is server-side work (the daily
-- mux_videos.purge-superseded job), not client-facing, so no fast
-- soft-delete flag is needed: multiple completed rows per project are
-- now legal, the newest completed version wins (shared-video-get
-- orders by cloud_version DESC), and the purge sweeps older ones.

DROP INDEX IF EXISTS public.idx_mux_videos_one_active_completed;
DROP INDEX IF EXISTS public.idx_mux_videos_deleted;
ALTER TABLE public.mux_videos DROP COLUMN IF EXISTS is_deleted;
