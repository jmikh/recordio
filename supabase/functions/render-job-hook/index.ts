import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { jsonResponse, errorResponse, withBoundary } from '../_shared/auth.ts';
import { uploadToMux } from '../_shared/muxUpload.ts';
import { captureException } from '../_shared/sentry.ts';

const RENDER_SECRET = Deno.env.get('RENDER_SECRET')!;
const MUX_TOKEN_ID = Deno.env.get('MUX_TOKEN_ID')!;
const MUX_TOKEN_SECRET = Deno.env.get('MUX_TOKEN_SECRET')!;

/**
 * Render Hook Edge Function (worker-only)
 *
 * Called by the render worker to report progress and durations.
 * Auth: RENDER_SECRET in Authorization header (not JWT — no withAuth).
 *
 * On completion: uploads to Mux directly if a pending mux_video exists
 * for the same (project_id, cloud_version).
 *
 * Request body: { jobId, status?, progress?, error?,
 *                 download_duration_s?, render_duration_s?, upload_duration_s? }
 * Response:     { ok: true, cancel: boolean }
 */
serve(withBoundary('render-job-hook', async (req) => {
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

    if (readError) throw new Error(`render_jobs lookup failed for ${jobId}`, { cause: readError });
    if (!job) return errorResponse('Job not found', 404);

    // 4. If job is not pending, signal cancel
    if (job.status !== 'pending') {
        console.log(`[render-job-hook] Job ${jobId} already ${job.status}, signaling cancel`);
        return jsonResponse({ ok: true, cancel: true });
    }

    // 5. Build duration/progress updates
    const now = new Date();
    const updates: Record<string, unknown> = { updated_at: now.toISOString() };
    if (progress !== undefined) updates.progress = progress;

    if (download_duration_s !== undefined) updates.download_duration_s = download_duration_s;
    if (render_duration_s !== undefined) updates.render_duration_s = render_duration_s;
    if (upload_duration_s !== undefined) updates.upload_duration_s = upload_duration_s;

    // Compute start_duration_s on first update (dispatch + cold start latency)
    if (job.start_duration_s === null) {
        updates.start_duration_s = (now.getTime() - new Date(job.created_at).getTime()) / 1000;
    }

    if (status === 'completed') {
        updates.total_duration_s = (now.getTime() - new Date(job.created_at).getTime()) / 1000;
        updates.progress = 1;
    }

    // Write duration/progress fields
    await adminSupabase
        .from('render_jobs')
        .update(updates)
        .eq('id', jobId);

    // 6. Terminal state — use render_job_complete to cascade failures to mux_videos
    if (status === 'completed' || status === 'failed') {
        console.log(`[render-job-hook] Job ${jobId} terminal: ${status}${errorMsg ? ` — ${errorMsg}` : ''}`);
        if (status === 'failed') {
            // Worker-reported failure: capture as a domain event, don't throw (the
            // hook itself succeeded, the render didn't).
            await captureException(new Error(errorMsg ?? 'Render job failed'), 'render-job-hook', { jobId });
        }
        await adminSupabase.rpc('render_job_complete', {
            p_job_id: jobId,
            p_status: status,
            p_error: errorMsg || null,
        });

        // On completion: upload to Mux if a pending mux_video exists for this version
        if (status === 'completed' && job.render_storage_path) {
            const { data: pendingMux } = await adminSupabase
                .from('mux_videos')
                .select('id')
                .eq('project_id', job.project_id)
                .eq('cloud_version', job.cloud_version)
                .eq('status', 'pending')
                .maybeSingle();

            if (pendingMux) {
                console.log(`[render-job-hook] Found pending mux_video ${pendingMux.id}, uploading to Mux`);
                const result = await uploadToMux({
                    adminSupabase,
                    muxVideoId: pendingMux.id,
                    renderStoragePath: job.render_storage_path,
                    muxTokenId: MUX_TOKEN_ID,
                    muxTokenSecret: MUX_TOKEN_SECRET,
                });
                if (!result.success) {
                    // Capture but don't throw — uploadToMux already marked the mux_video
                    // failed in the DB. Returning 200 keeps the worker happy.
                    await captureException(new Error(result.error ?? 'Mux upload failed'), 'render-job-hook', {
                        muxVideoId: pendingMux.id,
                    });
                }
            }
        }
    }

    return jsonResponse({ ok: true, cancel: false });
}));
