-- Render/Mux simplification Step 1 (expand): make the render→Mux link
-- explicit. A mux_video is a thin consumer of exactly one render job, but
-- until now the relationship was re-derived by (project_id, cloud_version
-- [, quality]) at four call sites. Add the FK here; readers stay on the
-- old derivation until Step 2 switches them over.
--
-- ON DELETE SET NULL: the superseded-render purge hard-deletes old
-- render_jobs rows — a superseded share losing its link is fine, and the
-- active share's render (latest version) is never purged.
ALTER TABLE public.mux_videos
    ADD COLUMN IF NOT EXISTS render_job_id UUID
        REFERENCES public.render_jobs(id) ON DELETE SET NULL;

-- Partial index (idx_mux_videos_asset_id style): serves Step 2's cascade
-- trigger lookup (WHERE render_job_id = NEW.id) and keeps the FK's
-- ON DELETE SET NULL from scanning mux_videos on every render purge.
CREATE INDEX IF NOT EXISTS idx_mux_videos_render_job_id
    ON public.mux_videos USING btree (render_job_id)
    WHERE (render_job_id IS NOT NULL);

-- Backfill, best-match-first; each tier only touches rows still NULL, so
-- the whole block is idempotent (Step 2's pre-flight re-runs it once to
-- cover rows created between this migration and the server deploy).
-- Non-completed render rows have no unique index (rare double-insert), so
-- every tier picks one deterministic winner per key via DISTINCT ON,
-- preferring completed then newest. Rows with no match at all keep
-- render_job_id NULL — superseded/dead shares whose render was purged.

-- Tier 1: exact file match — the render whose output Mux actually
-- ingested (render_storage_path was copied onto mux_videos at upload).
UPDATE public.mux_videos mv
SET render_job_id = rj.id
FROM (
    SELECT DISTINCT ON (project_id, cloud_version, render_storage_path)
        id, project_id, cloud_version, render_storage_path
    FROM public.render_jobs
    WHERE render_storage_path IS NOT NULL
    ORDER BY project_id, cloud_version, render_storage_path,
        (status = 'completed') DESC, created_at DESC
) rj
WHERE mv.render_job_id IS NULL
  AND mv.render_storage_path IS NOT NULL
  AND rj.project_id = mv.project_id
  AND rj.cloud_version = mv.cloud_version
  AND rj.render_storage_path = mv.render_storage_path;

-- Tier 2: the 2K render for the version — mux-video-create always
-- requests MUX_RENDER_QUALITY ('2K'), so this is the render the share
-- depends on even when the path no longer matches (reset/retried render,
-- pending in-flight rows).
UPDATE public.mux_videos mv
SET render_job_id = rj.id
FROM (
    SELECT DISTINCT ON (project_id, cloud_version)
        id, project_id, cloud_version
    FROM public.render_jobs
    WHERE quality = '2K'
    ORDER BY project_id, cloud_version,
        (status = 'completed') DESC, created_at DESC
) rj
WHERE mv.render_job_id IS NULL
  AND rj.project_id = mv.project_id
  AND rj.cloud_version = mv.cloud_version;

-- Tier 3: any completed render for the version — pre-multi-quality
-- history (those shares ingested the then-only 1080p render).
UPDATE public.mux_videos mv
SET render_job_id = rj.id
FROM (
    SELECT DISTINCT ON (project_id, cloud_version)
        id, project_id, cloud_version
    FROM public.render_jobs
    WHERE status = 'completed'
    ORDER BY project_id, cloud_version, created_at DESC
) rj
WHERE mv.render_job_id IS NULL
  AND rj.project_id = mv.project_id
  AND rj.cloud_version = mv.cloud_version;
