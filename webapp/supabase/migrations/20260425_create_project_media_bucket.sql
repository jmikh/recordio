-- Create the project-media storage bucket for screen/camera/mic recordings and thumbnails.
-- Access is controlled via signed URLs from edge functions (no client-side RLS needed).

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'project-media',
    'project-media',
    false,
    10737418240,  -- 10 GB per file
    ARRAY[
        'video/webm', 'video/mp4',
        'audio/wav', 'audio/webm', 'audio/mpeg',
        'image/png', 'image/jpeg', 'image/webp', 'image/avif'
    ]
)
ON CONFLICT (id) DO NOTHING;
