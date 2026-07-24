-- Fix: TUS resumable uploads to project-media 403 with "new row
-- violates row-level security policy" (found 2026-07-24, local AND
-- prod — project creation broken).
--
-- The client's tus upload sends x-upsert, and current storage-api
-- versions compile it to INSERT ... ON CONFLICT DO UPDATE. Postgres
-- additionally runs ON CONFLICT inserts through the table's SELECT
-- policies (the conflict-arbiter read) — and
-- 20260513194112_drop_all_rls_policies removed every SELECT policy
-- while 20260602212305 re-added only INSERT + UPDATE for
-- project-media. Isolated by test: a plain INSERT passes, any
-- ON CONFLICT variant fails, and adding this SELECT policy makes the
-- exact storage-api upsert succeed. (It worked when the TUS flow
-- shipped because older storage-api issued plain INSERTs.)

DROP POLICY IF EXISTS project_media_authenticated_select ON storage.objects;
CREATE POLICY project_media_authenticated_select ON storage.objects
    FOR SELECT TO authenticated
    USING (
        bucket_id = 'project-media'
        AND (storage.foldername(name))[1] = (SELECT auth.uid()::text)
    );
