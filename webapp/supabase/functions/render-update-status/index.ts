import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, jsonResponse, errorResponse } from '../_shared/auth.ts';

const RENDER_SECRET = Deno.env.get('RENDER_SECRET')!;

/**
 * Render Update Status Edge Function (worker-only)
 *
 * Called by the Fly.io render worker to report progress, completion, or failure.
 * Auth: RENDER_SECRET in Authorization header (not JWT — no withAuth).
 *
 * Request body: { jobId, status?, progress?, error? }
 * Response:     { ok: true, cancel: boolean }
 *
 * cancel=true tells the worker to abort (job was canceled or already finished).
 */
serve(async (req: Request) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        // 1. Verify RENDER_SECRET
        const authHeader = req.headers.get('Authorization');
        if (authHeader !== `Bearer ${RENDER_SECRET}`) {
            return errorResponse('Unauthorized', 401);
        }

        // 2. Parse request
        const { jobId, status, progress, error: errorMsg } = await req.json();
        if (!jobId) {
            return errorResponse('Missing jobId', 400);
        }

        const adminSupabase = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
        );

        // 3. Read current job status
        const { data: job, error: readError } = await adminSupabase
            .from('render_jobs')
            .select('status')
            .eq('id', jobId)
            .maybeSingle();

        if (readError || !job) {
            return errorResponse('Job not found', 404);
        }

        // 4. If current status is NOT pending, don't update — signal cancel
        if (job.status !== 'pending') {
            return jsonResponse({ ok: true, cancel: true });
        }

        // 5. Apply updates
        const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
        if (status) updates.status = status;
        if (progress !== undefined) updates.progress = progress;
        if (errorMsg) updates.error = errorMsg;

        await adminSupabase
            .from('render_jobs')
            .update(updates)
            .eq('id', jobId);

        return jsonResponse({ ok: true, cancel: false });
    } catch (err) {
        console.error('[render-update-status] Unexpected error:', err);
        return errorResponse('Internal server error', 500);
    }
});
