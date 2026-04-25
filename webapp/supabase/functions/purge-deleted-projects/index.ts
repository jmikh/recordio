import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/**
 * Purge-Deleted-Projects Edge Function
 *
 * Called daily by pg_cron via pg_net. Permanently deletes projects that have
 * been soft-deleted for more than 3 days.
 *
 * For each project:
 *   1. Deletes media files from Supabase Storage (screen, camera, mic, thumbnail)
 *   2. Queues any published CF Stream video into deleted_videos for async cleanup
 *   3. Hard-deletes the project row
 *
 * Authenticated via service role key (set by the cron job).
 */
serve(async (req) => {
    try {
        const authHeader = req.headers.get('Authorization');
        if (!authHeader) {
            return new Response(
                JSON.stringify({ error: 'Unauthorized' }),
                { status: 401, headers: { 'Content-Type': 'application/json' } }
            );
        }

        const supabase = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
        );

        // Fetch projects soft-deleted more than 3 days ago
        const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();

        const { data: projects, error: fetchError } = await supabase
            .from('projects')
            .select('id, screen_storage_path, camera_storage_path, mic_storage_path, thumbnail_storage_path, cf_video_uid')
            .not('deleted_at', 'is', null)
            .lt('deleted_at', threeDaysAgo)
            .limit(20);

        if (fetchError) {
            console.error('[purge-projects] Failed to fetch deleted projects:', fetchError);
            return new Response(
                JSON.stringify({ error: 'Failed to fetch deleted projects' }),
                { status: 500, headers: { 'Content-Type': 'application/json' } }
            );
        }

        if (!projects || projects.length === 0) {
            return new Response(
                JSON.stringify({ message: 'No projects to purge', processed: 0 }),
                { status: 200, headers: { 'Content-Type': 'application/json' } }
            );
        }

        let succeeded = 0;
        let failed = 0;

        for (const project of projects) {
            try {
                // 1. Delete media files from Supabase Storage
                const storagePaths = [
                    project.screen_storage_path,
                    project.camera_storage_path,
                    project.mic_storage_path,
                    project.thumbnail_storage_path,
                ].filter((p): p is string => !!p && p !== 'pending');

                if (storagePaths.length > 0) {
                    const { error: storageError } = await supabase.storage
                        .from('project-media')
                        .remove(storagePaths);

                    if (storageError) {
                        console.error(`[purge-projects] Storage delete failed for ${project.id}:`, storageError);
                        // Continue anyway — files may already be gone
                    }
                }

                // 2. Queue CF Stream video for async deletion (if published)
                if (project.cf_video_uid) {
                    const { error: queueError } = await supabase
                        .from('deleted_videos')
                        .insert({ cf_video_uid: project.cf_video_uid, source: 'project_purge' });

                    if (queueError) {
                        console.error(`[purge-projects] Failed to queue CF deletion for ${project.id}:`, queueError);
                    }
                }

                // 3. Hard-delete the project row
                const { error: deleteError } = await supabase
                    .from('projects')
                    .delete()
                    .eq('id', project.id);

                if (deleteError) {
                    console.error(`[purge-projects] Failed to delete project ${project.id}:`, deleteError);
                    failed++;
                } else {
                    succeeded++;
                }
            } catch (e) {
                console.error(`[purge-projects] Error processing project ${project.id}:`, e);
                failed++;
            }
        }

        console.log(`[purge-projects] Processed ${projects.length}: ${succeeded} succeeded, ${failed} failed`);

        return new Response(
            JSON.stringify({ processed: projects.length, succeeded, failed }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
    } catch (err) {
        console.error('[purge-projects] Unexpected error:', err);
        return new Response(
            JSON.stringify({ error: 'Internal server error' }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
    }
});
