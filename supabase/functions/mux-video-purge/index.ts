import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, jsonResponse, errorResponse } from '../_shared/auth.ts';
import { captureException } from '../_shared/sentry.ts';

const MUX_TOKEN_ID = Deno.env.get('MUX_TOKEN_ID')!;
const MUX_TOKEN_SECRET = Deno.env.get('MUX_TOKEN_SECRET')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const BUCKET = 'project-media';
const MUX_API_URL = Deno.env.get('MUX_API_URL') ?? 'https://api.mux.com';

/**
 * Mux Video Purge — cron cleanup (hourly via pg_cron -> pg_net)
 *
 * Finds mux_videos older than the highest completed version per project,
 * deletes their Mux assets and storage files, then deletes the rows.
 * Only deletes a row when both external resources are confirmed gone.
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
        const muxAuth = btoa(`${MUX_TOKEN_ID}:${MUX_TOKEN_SECRET}`);

        // Fetch old version rows via DB function
        const { data: rows, error: fetchError } = await adminSupabase
            .rpc('mux_video_purge_candidates')
            .select();

        if (fetchError || !rows) {
            console.error('[mux-video-purge] Failed to fetch candidates:', fetchError);
            return errorResponse('Failed to fetch candidates', 500);
        }

        let purged = 0;

        for (const row of rows) {
            try {
                // 1. Delete Mux asset (if exists)
                if (row.mux_asset_id) {
                    const resp = await fetch(`${MUX_API_URL}/video/v1/assets/${row.mux_asset_id}`, {
                        method: 'DELETE',
                        headers: { 'Authorization': `Basic ${muxAuth}` },
                    });
                    // 204 = deleted, 404 = already gone — both are success
                    if (!resp.ok && resp.status !== 404) {
                        console.warn(`[mux-video-purge] Mux delete failed for ${row.mux_asset_id}: ${resp.status}`);
                        continue; // leave for next run
                    }
                }

                // 2. Delete render file from storage (if exists)
                if (row.render_storage_path) {
                    const { error: removeError } = await adminSupabase
                        .storage.from(BUCKET)
                        .remove([row.render_storage_path]);

                    if (removeError) {
                        console.warn(`[mux-video-purge] Storage delete failed for ${row.render_storage_path}:`, removeError);
                        continue; // leave for next run
                    }
                }

                // 3. Delete the row
                await adminSupabase
                    .from('mux_videos')
                    .delete()
                    .eq('id', row.id);

                purged++;
            } catch (err) {
                console.warn(`[mux-video-purge] Error purging ${row.id}:`, err);
            }
        }

        console.log(`[mux-video-purge] Purged ${purged}/${rows.length} rows`);
        return jsonResponse({ ok: true, purged, total: rows.length });
    } catch (err) {
        console.error('[mux-video-purge] Unexpected error:', err);
        await captureException(err, { function: 'mux-video-purge' });
        return errorResponse('Internal server error', 500);
    }
});
