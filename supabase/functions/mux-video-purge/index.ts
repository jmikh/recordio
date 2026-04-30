import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, jsonResponse, errorResponse } from '../_shared/auth.ts';

const MUX_TOKEN_ID = Deno.env.get('MUX_TOKEN_ID')!;
const MUX_TOKEN_SECRET = Deno.env.get('MUX_TOKEN_SECRET')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

/**
 * Mux Video Purge — cron cleanup (hourly via pg_cron -> pg_net)
 *
 * Cleans up soft-deleted mux_videos:
 *   1. Delete Mux asset via API (idempotent — 404 is success)
 *   2. Delete the mux_videos row
 *
 * Storage cleanup (old render MP4s) deferred to a later phase.
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

        // 1. Fetch soft-deleted rows
        const { data: rows, error: fetchError } = await adminSupabase
            .from('mux_videos')
            .select('id, mux_asset_id')
            .eq('is_deleted', true)
            .limit(50);

        if (fetchError || !rows) {
            console.error('[mux-video-purge] Failed to fetch deleted rows:', fetchError);
            return errorResponse('Failed to fetch rows', 500);
        }

        let purged = 0;

        for (const row of rows) {
            try {
                // 2. Delete Mux asset (if exists)
                if (row.mux_asset_id) {
                    const resp = await fetch(`https://api.mux.com/video/v1/assets/${row.mux_asset_id}`, {
                        method: 'DELETE',
                        headers: { 'Authorization': `Basic ${muxAuth}` },
                    });
                    // 204 = deleted, 404 = already gone — both are success
                    if (!resp.ok && resp.status !== 404) {
                        console.warn(`[mux-video-purge] Mux delete failed for ${row.mux_asset_id}: ${resp.status}`);
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
        return errorResponse('Internal server error', 500);
    }
});
