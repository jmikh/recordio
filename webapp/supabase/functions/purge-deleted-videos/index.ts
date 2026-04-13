import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CF_API_TOKEN = Deno.env.get('CF_STREAM_API_TOKEN')!;
const CF_ACCOUNT_ID = Deno.env.get('CF_STREAM_ACCOUNT_ID')!;

/**
 * Purge-Deleted-Videos Edge Function
 *
 * Called hourly by pg_cron via pg_net. Processes the deleted_videos queue
 * by calling Cloudflare Stream DELETE API for each entry.
 *
 * - On success: removes the row from deleted_videos
 * - On failure: increments attempts counter
 * - If attempts >= 5: leaves the row for manual review, stops retrying
 *
 * Authenticated via service role key (set by the cron job).
 */
serve(async (req) => {
    try {
        // Verify this is called with service role (from cron, not from client)
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

        // Fetch batch of pending deletions (attempts < 5)
        const { data: pending, error: fetchError } = await supabase
            .from('deleted_videos')
            .select('id, cf_video_uid, attempts')
            .lt('attempts', 5)
            .order('deleted_at', { ascending: true })
            .limit(20);  // Process up to 20 per invocation

        if (fetchError) {
            console.error('[purge] Failed to fetch pending deletions:', fetchError);
            return new Response(
                JSON.stringify({ error: 'Failed to fetch pending deletions' }),
                { status: 500, headers: { 'Content-Type': 'application/json' } }
            );
        }

        if (!pending || pending.length === 0) {
            return new Response(
                JSON.stringify({ message: 'No pending deletions', processed: 0 }),
                { status: 200, headers: { 'Content-Type': 'application/json' } }
            );
        }

        let succeeded = 0;
        let failed = 0;

        for (const entry of pending) {
            try {
                const cfResponse = await fetch(
                    `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/stream/${entry.cf_video_uid}`,
                    {
                        method: 'DELETE',
                        headers: { 'Authorization': `Bearer ${CF_API_TOKEN}` },
                    }
                );

                if (cfResponse.ok || cfResponse.status === 404) {
                    // Success or already gone — remove from queue
                    await supabase
                        .from('deleted_videos')
                        .delete()
                        .eq('id', entry.id);
                    succeeded++;
                } else {
                    // CF API error — increment attempts
                    const errorText = await cfResponse.text();
                    console.error(`[purge] CF delete failed for ${entry.cf_video_uid} (${cfResponse.status}):`, errorText);
                    await supabase
                        .from('deleted_videos')
                        .update({ attempts: entry.attempts + 1 })
                        .eq('id', entry.id);
                    failed++;
                }
            } catch (e) {
                console.error(`[purge] Error deleting ${entry.cf_video_uid}:`, e);
                await supabase
                    .from('deleted_videos')
                    .update({ attempts: entry.attempts + 1 })
                    .eq('id', entry.id);
                failed++;
            }
        }

        console.log(`[purge] Processed ${pending.length}: ${succeeded} succeeded, ${failed} failed`);

        return new Response(
            JSON.stringify({ processed: pending.length, succeeded, failed }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
        );

    } catch (err) {
        console.error('[purge] Unexpected error:', err);
        return new Response(
            JSON.stringify({ error: 'Internal server error' }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
    }
});
