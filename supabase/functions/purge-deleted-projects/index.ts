import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { jsonResponse, errorResponse, withBoundary } from '../_shared/auth.ts';
import { captureException } from '../_shared/sentry.ts';

/**
 * Purge-Deleted-Projects Edge Function
 *
 * Called daily by pg_cron via pg_net. Permanently deletes projects that have
 * been soft-deleted for more than 3 days.
 *
 * Pipeline per project:
 *   1. Set permanently_deleted = true  (user can no longer restore)
 *   2. Delete all files from storage   (user_id/project_id/*)
 *   3. Hard-delete the project row
 *
 * If any step before (3) fails, we skip the row delete so we don't create
 * orphaned storage. The project will be retried next run.
 *
 * Authenticated via service role key (set by the cron job).
 */
serve(withBoundary('purge-deleted-projects', async (req) => {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return errorResponse('Unauthorized', 401);

    const supabase = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    // Fetch projects soft-deleted more than 30 days ago that haven't been
    // partially processed yet (permanently_deleted = false means fresh).
    // Also pick up permanently_deleted = true from a previous failed run.
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const { data: projects, error: fetchError } = await supabase
        .from('projects')
        .select('id, created_by, permanently_deleted')
        .not('deleted_at', 'is', null)
        .lt('deleted_at', thirtyDaysAgo)
        .limit(20);

    if (fetchError) throw new Error('Failed to fetch deleted projects', { cause: fetchError });

    if (!projects || projects.length === 0) {
        return jsonResponse({ message: 'No projects to purge', processed: 0 });
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

                if (markError) throw new Error('mark permanently_deleted failed', { cause: markError });
            }

            // 2. Delete all files from storage (created_by/project_id/*)
            const prefix = `${project.created_by}/${project.id}`;
            const { data: files, error: listError } = await supabase.storage
                .from('project-media')
                .list(prefix);

            if (listError) throw new Error('storage list failed', { cause: listError });

            if (files && files.length > 0) {
                const { error: removeError } = await supabase.storage
                    .from('project-media')
                    .remove(files.map(f => `${prefix}/${f.name}`));

                if (removeError) throw new Error('storage delete failed', { cause: removeError });
            }

            // 3. Hard-delete the project row (only if all above succeeded)
            const { error: deleteError } = await supabase
                .from('projects')
                .delete()
                .eq('id', project.id);

            if (deleteError) throw new Error('project delete failed', { cause: deleteError });

            succeeded++;
        } catch (err) {
            // Per-project catch so one bad row doesn't kill the batch.
            // Report each failure; row will be retried on the next cron run.
            failed++;
            await captureException(err, 'purge-deleted-projects', { projectId: project.id });
        }
    }

    console.log(`[purge-projects] Processed ${projects.length}: ${succeeded} succeeded, ${failed} failed`);
    return jsonResponse({ processed: projects.length, succeeded, failed });
}));
