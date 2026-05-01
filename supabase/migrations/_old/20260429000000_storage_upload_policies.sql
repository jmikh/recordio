-- Allow authenticated users to upload/update/read their own files via TUS resumable uploads.
-- Paths follow the pattern: {user_id}/{project_id}/{fileType}.{ext}
-- Quota validation still happens in the storage-upload-url edge function before upload begins.

-- SELECT: needed for TUS upsert — storage checks if object already exists before overwriting
CREATE POLICY "Users can read own files"
ON storage.objects
FOR SELECT
TO authenticated
USING (
    bucket_id = 'project-media'
    AND auth.uid()::text = split_part(name, '/', 1)
);

-- INSERT: create new objects in the user's own folder
CREATE POLICY "Users can upload to own folder"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
    bucket_id = 'project-media'
    AND auth.uid()::text = split_part(name, '/', 1)
);

-- UPDATE: overwrite existing objects (upsert)
CREATE POLICY "Users can overwrite own files"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
    bucket_id = 'project-media'
    AND auth.uid()::text = split_part(name, '/', 1)
)
WITH CHECK (
    bucket_id = 'project-media'
    AND auth.uid()::text = split_part(name, '/', 1)
);
