ALTER TABLE public.mux_videos
    ADD COLUMN IF NOT EXISTS render_job_id UUID REFERENCES public.render_jobs(id);

CREATE INDEX IF NOT EXISTS idx_mux_videos_render_job
    ON public.mux_videos(render_job_id)
    WHERE render_job_id IS NOT NULL;
