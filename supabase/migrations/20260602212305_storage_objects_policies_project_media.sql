-- Allow authenticated users to upload/update objects in the project-media bucket,
-- restricted to paths that begin with their own auth.uid().
--
-- Needed for the TUS resumable upload flow in project-create-v2: client uploads
-- go through Supabase Storage's REST API (subject to RLS on storage.objects),
-- not via S3 presigned URLs.
--
-- SELECT/DELETE on storage.objects intentionally stay closed — those operations
-- continue to flow through SECURITY DEFINER edge functions (storage-download-urls,
-- purge-deleted-projects, etc.).

CREATE POLICY "project_media_authenticated_insert"
    ON storage.objects FOR INSERT
    TO authenticated
    WITH CHECK (
        bucket_id = 'project-media'
        AND (storage.foldername(name))[1] = (SELECT auth.uid()::text)
    );

CREATE POLICY "project_media_authenticated_update"
    ON storage.objects FOR UPDATE
    TO authenticated
    USING (
        bucket_id = 'project-media'
        AND (storage.foldername(name))[1] = (SELECT auth.uid()::text)
    )
    WITH CHECK (
        bucket_id = 'project-media'
        AND (storage.foldername(name))[1] = (SELECT auth.uid()::text)
    );
