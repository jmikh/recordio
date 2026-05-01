import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, jsonResponse, errorResponse } from '../_shared/auth.ts';

const MUX_WEBHOOK_SECRET = Deno.env.get('MUX_WEBHOOK_SECRET')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

/**
 * Mux Video Hook — receives Mux webhook events
 *
 * Handles:
 *   video.asset.ready   -> mux_video_complete DB function (atomic: mark completed + retire old)
 *   video.asset.errored -> mark mux_video failed
 *
 * Auth: Mux webhook signature verification (HMAC-SHA256)
 */
serve(async (req: Request) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        // 1. Verify Mux webhook signature
        const signature = req.headers.get('mux-signature');
        if (!signature) {
            return errorResponse('Missing mux-signature header', 401);
        }

        const body = await req.text();

        // Mux signatures: t=<timestamp>,v1=<hash>
        const elements = signature.split(',');
        const timestamp = elements.find(e => e.startsWith('t='))?.slice(2);
        const v1Sig = elements.find(e => e.startsWith('v1='))?.slice(3);

        if (!timestamp || !v1Sig) {
            return errorResponse('Invalid signature format', 401);
        }

        const encoder = new TextEncoder();
        const key = await crypto.subtle.importKey(
            'raw',
            encoder.encode(MUX_WEBHOOK_SECRET),
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['sign'],
        );
        const signed = await crypto.subtle.sign(
            'HMAC',
            key,
            encoder.encode(`${timestamp}.${body}`),
        );
        const expectedSig = Array.from(new Uint8Array(signed))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');

        if (expectedSig !== v1Sig) {
            return errorResponse('Invalid signature', 401);
        }

        // 2. Parse event
        const event = JSON.parse(body);
        const eventType = event.type;
        const assetId = event.data?.id;

        if (!assetId) {
            return jsonResponse({ ok: true, message: 'No asset ID, ignoring' });
        }

        const adminSupabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

        // 3. Handle video.asset.ready — atomic via DB function
        if (eventType === 'video.asset.ready') {
            const playbackId = event.data.playback_ids?.[0]?.id;
            if (!playbackId) {
                console.error('[mux-video-hook] asset.ready but no playback_id:', assetId);
                return errorResponse('No playback_id in ready event', 500);
            }

            const { data: result, error: rpcError } = await adminSupabase
                .rpc('mux_video_complete', {
                    p_mux_asset_id: assetId,
                    p_playback_id: playbackId,
                })
                .single();

            if (rpcError) {
                console.error('[mux-video-hook] mux_video_complete failed:', rpcError);
                return errorResponse('DB function failed', 500);
            }

            if (!result?.found) {
                console.warn('[mux-video-hook] No pending mux_video for asset:', assetId);
                return jsonResponse({ ok: true, message: 'No matching pending row' });
            }

            console.log(`[mux-video-hook] asset.ready: ${assetId} -> mux_video ${result.mux_video_id} completed`);
            return jsonResponse({ ok: true });
        }

        // 4. Handle video.asset.errored
        if (eventType === 'video.asset.errored') {
            const errorMessages = event.data.errors?.messages?.join('; ') ?? 'Unknown Mux error';

            const { data: muxVideo } = await adminSupabase
                .from('mux_videos')
                .select('id')
                .eq('mux_asset_id', assetId)
                .eq('status', 'pending')
                .maybeSingle();

            if (muxVideo) {
                await adminSupabase
                    .from('mux_videos')
                    .update({
                        status: 'failed',
                        error: errorMessages,
                        updated_at: new Date().toISOString(),
                    })
                    .eq('id', muxVideo.id);

                console.log(`[mux-video-hook] asset.errored: ${assetId} -> mux_video ${muxVideo.id} failed`);
            }

            return jsonResponse({ ok: true });
        }

        // Unhandled event — acknowledge to prevent retries
        return jsonResponse({ ok: true, message: `Ignored event: ${eventType}` });
    } catch (err) {
        console.error('[mux-video-hook] Unexpected error:', err);
        return errorResponse('Internal server error', 500);
    }
});
