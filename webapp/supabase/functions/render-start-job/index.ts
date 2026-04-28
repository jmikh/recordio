import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { withAuth, jsonResponse, errorResponse } from '../_shared/auth.ts';

const RENDER_WORKER_URL = Deno.env.get('RENDER_WORKER_URL')!;
const RENDER_SECRET = Deno.env.get('RENDER_SECRET')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const BUCKET = 'project-media';

/**
 * Render Start Job Edge Function
 *
 * Authenticates user, checks for cache hit / dedup, cancels stale jobs,
 * generates signed media URLs, creates a render_jobs row, and dispatches
 * work to the Fly.io render worker. The worker receives only signed URLs —
 * no Supabase credentials.
 *
 * Request body: { projectId }
 * Response:     { jobId, status }
 */
serve(withAuth(async (req, { user, supabase }) => {
    // 1. Check Pro subscription
    const { data: subscription } = await supabase
        .from('subscriptions')
        .select('status')
        .eq('user_id', user.id)
        .maybeSingle();

    const hasAccess = subscription?.status === 'active' || subscription?.status === 'trialing';
    if (!hasAccess) {
        return jsonResponse({ error: 'pro_required', message: 'Pro subscription required for server rendering.' }, 403);
    }

    // 2. Parse request
    const { projectId } = await req.json();
    if (!projectId) {
        return errorResponse('Missing projectId', 400);
    }

    // 3. Look up project (RLS enforced — must belong to user)
    const { data: project, error: projectError } = await supabase
        .from('projects')
        .select('id, project_data, cloud_version, screen_storage_path, camera_storage_path, mic_storage_path')
        .eq('id', projectId)
        .is('deleted_at', null)
        .maybeSingle();

    if (projectError || !project) {
        return errorResponse('Project not found', 404);
    }

    const adminSupabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // 4. Cache hit: completed job with same project_id + cloud_version
    const { data: cached } = await adminSupabase
        .from('render_jobs')
        .select('id, status')
        .eq('project_id', projectId)
        .eq('cloud_version', project.cloud_version)
        .eq('status', 'completed')
        .maybeSingle();

    if (cached) {
        return jsonResponse({ jobId: cached.id, status: 'completed' });
    }

    // 5. Dedup: pending job with same project_id + cloud_version
    const { data: pending } = await adminSupabase
        .from('render_jobs')
        .select('id, status')
        .eq('project_id', projectId)
        .eq('cloud_version', project.cloud_version)
        .eq('status', 'pending')
        .maybeSingle();

    if (pending) {
        return jsonResponse({ jobId: pending.id, status: 'pending' });
    }

    // 6. Cancel stale: set all pending jobs for this project to canceled
    await adminSupabase
        .from('render_jobs')
        .update({ status: 'canceled', updated_at: new Date().toISOString() })
        .eq('project_id', projectId)
        .eq('status', 'pending');

    // 7. Generate signed download URLs for media (1h expiry)
    const mediaUrls: Record<string, string> = {};
    const storagePaths = {
        screen: project.screen_storage_path,
        camera: project.camera_storage_path,
        mic: project.mic_storage_path,
    };

    for (const [key, storagePath] of Object.entries(storagePaths)) {
        if (storagePath && storagePath !== 'pending') {
            const { data, error } = await adminSupabase
                .storage.from(BUCKET)
                .createSignedUrl(storagePath, 3600);
            if (error || !data) {
                console.error(`[render-start-job] Failed to sign ${key}:`, error);
                return errorResponse(`Failed to create signed URL for ${key}`, 500);
            }
            mediaUrls[key] = data.signedUrl;
        }
    }

    // 8. Generate signed upload URL for output
    const outputStoragePath = `${user.id}/${projectId}/render_1080p.mp4`;

    const { data: uploadData, error: uploadError } = await adminSupabase
        .storage.from(BUCKET)
        .createSignedUploadUrl(outputStoragePath, { upsert: true });

    if (uploadError || !uploadData) {
        console.error('[render-start-job] Failed to create upload URL:', uploadError);
        return errorResponse('Failed to create upload URL', 500);
    }

    // 9. Insert render_jobs row
    const { data: job, error: insertError } = await adminSupabase
        .from('render_jobs')
        .insert({
            project_id: projectId,
            user_id: user.id,
            quality: '1080p',
            cloud_version: project.cloud_version,
            output_storage_path: outputStoragePath,
        })
        .select('id')
        .single();

    if (insertError || !job) {
        console.error('[render-start-job] Failed to create job:', insertError);
        return errorResponse('Failed to create render job', 500);
    }

    // 10. Dispatch to worker (10s timeout)
    const statusCallbackUrl = `${SUPABASE_URL}/functions/v1/render-update-status`;

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10_000);

        const workerResp = await fetch(`${RENDER_WORKER_URL}/render`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${RENDER_SECRET}`,
            },
            body: JSON.stringify({
                jobId: job.id,
                projectData: project.project_data,
                quality: '1080p',
                mediaUrls,
                uploadUrl: uploadData.signedUrl,
                statusCallbackUrl,
            }),
            signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!workerResp.ok) {
            const errorText = await workerResp.text();
            console.error(`[render-start-job] Worker rejected job: ${workerResp.status} ${errorText}`);
            await adminSupabase
                .from('render_jobs')
                .update({ status: 'failed', error: `Worker rejected: ${workerResp.status}`, updated_at: new Date().toISOString() })
                .eq('id', job.id);
            return errorResponse('Render worker rejected the job', 502);
        }
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[render-start-job] Worker unreachable:', message);
        await adminSupabase
            .from('render_jobs')
            .update({ status: 'failed', error: `Worker unreachable: ${message}`, updated_at: new Date().toISOString() })
            .eq('id', job.id);
        return errorResponse('Render worker is unavailable', 503);
    }

    // 11. Job accepted
    return jsonResponse({ jobId: job.id, status: 'pending' });
}));
