import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { jsonResponse, errorResponse, withBoundary } from '../_shared/auth.ts';
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
serve(withBoundary('mux-video-purge', async (req) => {
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

    if (fetchError) throw new Error('mux_video_purge_candidates failed', { cause: fetchError });
    if (!rows) return jsonResponse({ ok: true, purged: 0, total: 0 });

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
                    throw new Error(`Mux delete failed for ${row.mux_asset_id}: ${resp.status}`);
                }
            }

            // 2. Delete render file from storage (if exists)
            if (row.render_storage_path) {
                const { error: removeError } = await adminSupabase
                    .storage.from(BUCKET)
                    .remove([row.render_storage_path]);

                if (removeError) {
                    throw new Error(`Storage delete failed for ${row.render_storage_path}`, { cause: removeError });
                }
            }

            // 3. Delete the row
            await adminSupabase
                .from('mux_videos')
                .delete()
                .eq('id', row.id);

            purged++;
        } catch (err) {
            // Per-row catch so one bad row doesn't kill the batch.
            // Report each to Sentry; row is left for next run.
            await captureException(err, { function: 'mux-video-purge', muxVideoId: row.id });
        }
    }

    console.log(`[mux-video-purge] Purged ${purged}/${rows.length} rows`);
    return jsonResponse({ ok: true, purged, total: rows.length });
}));
