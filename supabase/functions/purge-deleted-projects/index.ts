import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/**
 * Purge-Deleted-Projects Edge Function
 *
 * Called daily by pg_cron via pg_net. Permanently deletes projects that have
 * been soft-deleted for more than 3 days.
 *
 * Pipeline per project:
 *   1. Set permanently_deleted = true  (user can no longer restore)
 *   2. Delete all files from storage   (user_id/project_id/*)
 *   3. Queue CF Stream video into deleted_cf_streams for async cleanup
 *   4. Hard-delete the project row
 *
 * If any step before (4) fails, we skip the row delete so we don't create
 * orphaned storage/CF resources. The project will be retried next run.
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

        // Fetch projects soft-deleted more than 3 days ago that haven't been
        // partially processed yet (permanently_deleted = false means fresh).
        // Also pick up permanently_deleted = true from a previous failed run.
        const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();

        const { data: projects, error: fetchError } = await supabase
            .from('projects')
            .select('id, user_id, cf_video_uid, permanently_deleted')
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
                // 1. Mark permanently deleted (user can no longer restore)
                if (!project.permanently_deleted) {
                    const { error: markError } = await supabase
                        .from('projects')
                        .update({ permanently_deleted: true })
                        .eq('id', project.id);

                    if (markError) {
                        console.error(`[purge-projects] Failed to mark permanently_deleted for ${project.id}:`, markError);
                        failed++;
                        continue;
                    }
                }

                // 2. Delete all files from storage (user_id/project_id/*)
                const prefix = `${project.user_id}/${project.id}`;
                const { data: files, error: listError } = await supabase.storage
                    .from('project-media')
                    .list(prefix);

                if (listError) {
                    console.error(`[purge-projects] Storage list failed for ${project.id}:`, listError);
                    failed++;
                    continue;
                }

                if (files && files.length > 0) {
                    const { error: removeError } = await supabase.storage
                        .from('project-media')
                        .remove(files.map(f => `${prefix}/${f.name}`));

                    if (removeError) {
                        console.error(`[purge-projects] Storage delete failed for ${project.id}:`, removeError);
                        failed++;
                        continue;
                    }
                }

                // 3. Queue CF Stream video for async deletion (if published)
                if (project.cf_video_uid) {
                    const { error: queueError } = await supabase
                        .from('deleted_cf_streams')
                        .insert({ cf_video_uid: project.cf_video_uid, source: 'project_purge' });

                    if (queueError) {
                        console.error(`[purge-projects] Failed to queue CF deletion for ${project.id}:`, queueError);
                        failed++;
                        continue;
                    }
                }

                // 4. Hard-delete the project row (only if all above succeeded)
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
