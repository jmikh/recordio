-- Add attempt_count to render_jobs and change progress default to NULL
-- attempt_count tracks how many times a job has been attempted (retried)
-- progress NULL means "queuing", 0 means "starting" (set when worker picks up)

ALTER TABLE public.render_jobs
  ADD COLUMN IF NOT EXISTS "attempt_count" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE public.render_jobs
  ALTER COLUMN "progress" SET DEFAULT NULL;
