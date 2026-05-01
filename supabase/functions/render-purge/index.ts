import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, jsonResponse, errorResponse } from '../_shared/auth.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const BUCKET = 'project-media';

/**
 * Render Purge — cron cleanup (hourly via pg_cron -> pg_net)
 *
 * For each project, finds the highest completed cloud_version in render_jobs,
 * then deletes all older completed/failed/canceled rows after removing their
 * files from storage. Pending jobs are never touched.
 *
 * Per-row flow:
 *   1. Delete render file from storage (skip if no path or already gone)
 *   2. Delete the render_jobs row
 *
 * Auth: service role key (from pg_net cron)
 */
serve(async (req: Request) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        const authHeader = req.headers.get('Authorization');
        if (authHeader !== `Bearer ${SERVICE_ROLE_KEY}`) {
            return errorResponse('Unauthorized', 401);
        }

        const adminSupabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

        // 1. Find the highest completed cloud_version per project
        const { data: latest, error: latestError } = await adminSupabase
            .rpc('render_purge_candidates')
            .select();

        if (latestError || !latest) {
            console.error('[render-purge] Failed to fetch candidates:', latestError);
            return errorResponse('Failed to fetch candidates', 500);
        }

        let purged = 0;

        for (const row of latest) {
            try {
                // 2. Delete file from storage (if path exists)
                if (row.render_storage_path) {
                    const { error: removeError } = await adminSupabase
                        .storage.from(BUCKET)
                        .remove([row.render_storage_path]);

                    // Ignore "not found" — file may already be gone
                    if (removeError) {
                        console.warn(`[render-purge] Storage delete failed for ${row.render_storage_path}:`, removeError);
                        continue; // leave for next run
                    }
                }

                // 3. Delete the row
                await adminSupabase
                    .from('render_jobs')
                    .delete()
                    .eq('id', row.id);

                purged++;
            } catch (err) {
                console.warn(`[render-purge] Error purging ${row.id}:`, err);
            }
        }

        console.log(`[render-purge] Purged ${purged}/${latest.length} rows`);
        return jsonResponse({ ok: true, purged, total: latest.length });
    } catch (err) {
        console.error('[render-purge] Unexpected error:', err);
        return errorResponse('Internal server error', 500);
    }
});
