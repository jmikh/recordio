import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, jsonResponse, errorResponse } from '../_shared/auth.ts';

const RENDER_SECRET = Deno.env.get('RENDER_SECRET')!;

/**
 * Render Update Status Edge Function (worker-only)
 *
 * Called by the render worker to report progress and durations.
 * Auth: RENDER_SECRET in Authorization header (not JWT — no withAuth).
 *
 * Request body: { jobId, status?, progress?, error?,
 *                 download_duration_s?, render_duration_s?, upload_duration_s? }
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
        const {
            jobId, status, progress, error: errorMsg,
            download_duration_s, render_duration_s, upload_duration_s,
        } = await req.json();
        if (!jobId) {
            return errorResponse('Missing jobId', 400);
        }

        const adminSupabase = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
        );

        // 3. Read current job
        const { data: job, error: readError } = await adminSupabase
            .from('render_jobs')
            .select('status, created_at, start_duration_s, project_id, cloud_version, render_storage_path')
            .eq('id', jobId)
            .maybeSingle();

        if (readError || !job) {
            return errorResponse('Job not found', 404);
        }

        // 4. If job is not pending, signal cancel
        if (job.status !== 'pending') {
            return jsonResponse({ ok: true, cancel: true });
        }

        // 5. Build updates
        const now = new Date();
        const updates: Record<string, unknown> = { updated_at: now.toISOString() };
        if (status) updates.status = status;
        if (progress !== undefined) updates.progress = progress;
        if (errorMsg) updates.error = errorMsg;

        // Store durations reported by worker
        if (download_duration_s !== undefined) updates.download_duration_s = download_duration_s;
        if (render_duration_s !== undefined) updates.render_duration_s = render_duration_s;
        if (upload_duration_s !== undefined) updates.upload_duration_s = upload_duration_s;

        // Compute start_duration_s on first update (dispatch + cold start latency)
        if (job.start_duration_s === null) {
            updates.start_duration_s = (now.getTime() - new Date(job.created_at).getTime()) / 1000;
        }

        // Compute total_duration_s on completion
        if (status === 'completed') {
            updates.total_duration_s = (now.getTime() - new Date(job.created_at).getTime()) / 1000;
            updates.progress = 1;
        }

        await adminSupabase
            .from('render_jobs')
            .update(updates)
            .eq('id', jobId);

        // 6. On completion, update the project with render result
        if (status === 'completed') {
            await adminSupabase
                .from('projects')
                .update({
                    render_storage_path: job.render_storage_path,
                    render_cloud_version: job.cloud_version,
                    updated_at: now.toISOString(),
                })
                .eq('id', job.project_id);
        }

        return jsonResponse({ ok: true, cancel: false });
    } catch (err) {
        console.error('[render-update-status] Unexpected error:', err);
        return errorResponse('Internal server error', 500);
    }
});
